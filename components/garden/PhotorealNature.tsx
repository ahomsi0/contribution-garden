"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Clone, useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import type { GardenQuality, GardenSeason } from "./types";
import { createPhotorealIslandSurfaceSampler } from "./photoreal-geometry";

const SHRUB_MODEL_URL = "/photoreal/shrub_04/shrub_04_1k.gltf";
const FERN_MODEL_URL = "/photoreal/fern_02/fern_02_1k.gltf";
const ROCK_MODEL_URL =
  "/photoreal/rock_moss_set_01/rock_moss_set_01_1k.gltf";
const OPTIONAL_TREE_MODEL_URL = "/photoreal/island_tree_01.glb";
const TREE_LEAF_ALPHA_URL =
  "/photoreal/island_tree_01_leaves_alpha_1k.png";

const ISLAND_RADIUS = 11.5;
const POND_X = -2.35;
const POND_Z = 1.25;
const HERO_TREE_X = 2.62;
const HERO_TREE_Z = 0.48;

type NatureKind = "shrub" | "fern" | "rock" | "tree";
type VectorTuple = [number, number, number];

export interface PhotorealNatureProps {
  seed: number | string;
  quality: GardenQuality;
  season: GardenSeason;
  health: number;
  reducedMotion: boolean;
  terrainSeed: number;
  surfaceOffset?: number;
  heroScale?: number;
  onHeroSelect?: () => void;
}

interface NaturePlacement {
  position: VectorTuple;
  rotation: VectorTuple;
  scale: number;
  phase: number;
}

interface ScatterOptions {
  count: number;
  seed: number;
  innerRadius: number;
  outerRadius: number;
  edgeMargin: number;
  pathClearance: number;
  pondClearance: number;
  heroClearance: number;
  minDistance: number;
  clusterSize: number;
  clusterSpread: number;
  minScale: number;
  maxScale: number;
  groundOffset: number;
  maxTilt: number;
}

const BASE_COUNTS: Record<
  GardenQuality,
  { shrubs: number; ferns: number; rocks: number; trees: number }
> = {
  low: { shrubs: 8, ferns: 12, rocks: 4, trees: 0 },
  medium: { shrubs: 14, ferns: 22, rocks: 4, trees: 0 },
  high: { shrubs: 20, ferns: 32, rocks: 6, trees: 1 },
};

const SEASON_DENSITY: Record<
  GardenSeason,
  { shrubs: number; ferns: number }
> = {
  spring: { shrubs: 1, ferns: 1.08 },
  summer: { shrubs: 1, ferns: 1 },
  autumn: { shrubs: 0.9, ferns: 0.76 },
  winter: { shrubs: 0.62, ferns: 0.24 },
};

const SEASON_TINT: Record<GardenSeason, THREE.ColorRepresentation> = {
  spring: "#a6bb91",
  summer: "#82966f",
  autumn: "#9a7c54",
  winter: "#87908a",
};

let optionalTreePromise: Promise<THREE.Object3D | null> | null = null;
let optionalTreeRetryNotBefore = 0;
/** Cooldown before another attempt after the optional tree fails to load. */
const OPTIONAL_TREE_RETRY_COOLDOWN_MS = 30_000;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed: number | string) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return Math.abs(Math.trunc(seed)) >>> 0;
  }
  return hashString(String(seed));
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function distanceToMainPath(x: number, z: number) {
  return Math.abs(z + x * 0.24 + 2.3) / Math.sqrt(1 + 0.24 * 0.24);
}

function isAllowedPlacement(
  x: number,
  z: number,
  options: ScatterOptions,
) {
  if (Math.hypot(x, z) > ISLAND_RADIUS - options.edgeMargin) return false;
  if (distanceToMainPath(x, z) < options.pathClearance) return false;

  const pondRadiusX = 2.15 + options.pondClearance;
  const pondRadiusZ = 1.42 + options.pondClearance * 0.72;
  const pondDistance =
    ((x - POND_X) * (x - POND_X)) / (pondRadiusX * pondRadiusX) +
    ((z - POND_Z) * (z - POND_Z)) / (pondRadiusZ * pondRadiusZ);
  if (pondDistance < 1) return false;

  if (
    Math.hypot(x - HERO_TREE_X, z - HERO_TREE_Z) < options.heroClearance
  ) {
    return false;
  }

  return true;
}

function randomPointInRing(
  random: () => number,
  innerRadius: number,
  outerRadius: number,
) {
  const angle = random() * Math.PI * 2;
  const innerSquared = innerRadius * innerRadius;
  const outerSquared = outerRadius * outerRadius;
  const radius = Math.sqrt(
    innerSquared + random() * (outerSquared - innerSquared),
  );
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

function createClusteredPlacements(options: ScatterOptions) {
  if (options.count <= 0) return [];

  const random = seededRandom(options.seed);
  const centerCount = Math.max(
    1,
    Math.ceil(options.count / options.clusterSize),
  );
  const centers: Array<{ x: number; z: number }> = [];

  for (
    let attempt = 0;
    attempt < centerCount * 80 && centers.length < centerCount;
    attempt += 1
  ) {
    const point = randomPointInRing(
      random,
      options.innerRadius,
      options.outerRadius,
    );
    if (isAllowedPlacement(point.x, point.z, options)) centers.push(point);
  }

  if (centers.length === 0) return [];

  const placements: NaturePlacement[] = [];
  for (let index = 0; index < options.count; index += 1) {
    const center = centers[index % centers.length];
    let accepted: { x: number; z: number } | null = null;

    for (let attempt = 0; attempt < 36; attempt += 1) {
      const scatterAngle = random() * Math.PI * 2;
      const scatterRadius =
        Math.sqrt(random()) *
        options.clusterSpread *
        (0.72 + random() * 0.56);
      const x = center.x + Math.cos(scatterAngle) * scatterRadius;
      const z = center.z + Math.sin(scatterAngle) * scatterRadius;

      if (!isAllowedPlacement(x, z, options)) continue;
      if (
        placements.some(
          (placement) =>
            Math.hypot(
              placement.position[0] - x,
              placement.position[2] - z,
            ) < options.minDistance,
        )
      ) {
        continue;
      }

      accepted = { x, z };
      break;
    }

    if (!accepted) {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const point = randomPointInRing(
          random,
          options.innerRadius,
          options.outerRadius,
        );
        if (!isAllowedPlacement(point.x, point.z, options)) continue;
        accepted = point;
        break;
      }
    }

    if (!accepted) continue;

    const scale =
      options.minScale +
      random() * (options.maxScale - options.minScale);
    placements.push({
      position: [
        accepted.x,
        options.groundOffset - Math.max(0, scale - 1) * 0.025,
        accepted.z,
      ],
      rotation: [
        (random() - 0.5) * options.maxTilt,
        random() * Math.PI * 2,
        (random() - 0.5) * options.maxTilt,
      ],
      scale,
      phase: random() * Math.PI * 2,
    });
  }

  return placements;
}

function setTextureColorSpace(
  texture: THREE.Texture | null,
  colorSpace: THREE.ColorSpace,
) {
  if (!texture) return;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
}

function configureMaterial(
  source: THREE.Material,
  kind: NatureKind,
  season: GardenSeason,
  health: number,
  foliageAlphaMap?: THREE.Texture,
) {
  const material = source.clone();
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;

  setTextureColorSpace(material.map, THREE.SRGBColorSpace);
  setTextureColorSpace(material.emissiveMap, THREE.SRGBColorSpace);
  setTextureColorSpace(material.alphaMap, THREE.NoColorSpace);
  setTextureColorSpace(material.aoMap, THREE.NoColorSpace);
  setTextureColorSpace(material.normalMap, THREE.NoColorSpace);
  setTextureColorSpace(material.roughnessMap, THREE.NoColorSpace);
  setTextureColorSpace(material.metalnessMap, THREE.NoColorSpace);

  const materialName = material.name.toLowerCase();
  const isTreeLeaf =
    kind === "tree" && /leaf|leaves|foliage/.test(materialName);
  const looksLikeFoliage =
    kind === "fern" ||
    /leaf|leaves|foliage|fern|shrub|plant|needle|moss/.test(materialName);
  if (
    isTreeLeaf &&
    foliageAlphaMap &&
    material.map
  ) {
    material.alphaMap = foliageAlphaMap;
  }
  const usesCutout =
    material.alphaTest > 0 ||
    material.alphaMap !== null ||
    (kind !== "rock" && material.transparent);

  if (usesCutout) {
    material.alphaTest = Math.max(isTreeLeaf ? 0.4 : 0.34, material.alphaTest);
    material.transparent = false;
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
    material.alphaToCoverage = true;
  }

  material.metalness = 0;
  material.roughness = Math.max(
    material.roughness,
    kind === "rock" ? 0.82 : 0.7,
  );
  material.envMapIntensity = kind === "rock" ? 0.62 : 0.48;

  if (looksLikeFoliage) {
    const seasonalTint = new THREE.Color(SEASON_TINT[season]);
    const dryTint = new THREE.Color("#786d50");
    const seasonMix =
      season === "summer"
        ? 0.035
        : season === "spring"
          ? 0.075
          : season === "autumn"
            ? 0.16
            : 0.24;
    material.color.lerp(seasonalTint, seasonMix);
    material.color.lerp(dryTint, (1 - health) * 0.24);
  }

  material.needsUpdate = true;
  return material;
}

function prepareModel(
  source: THREE.Object3D,
  kind: NatureKind,
  quality: GardenQuality,
  season: GardenSeason,
  health: number,
  foliageAlphaMap?: THREE.Texture,
) {
  const prepared = source.clone(true);
  const materialClones = new Map<THREE.Material, THREE.Material>();
  const shouldCastShadow =
    quality === "high" ||
    kind === "tree" ||
    (quality === "medium" && kind !== "fern");

  prepared.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    child.castShadow = shouldCastShadow;
    child.receiveShadow = true;
    child.frustumCulled = true;

    const cloneMaterial = (material: THREE.Material) => {
      const cached = materialClones.get(material);
      if (cached) return cached;
      const clone = configureMaterial(
        material,
        kind,
        season,
        health,
        foliageAlphaMap,
      );
      materialClones.set(material, clone);
      return clone;
    };

    child.material = Array.isArray(child.material)
      ? child.material.map(cloneMaterial)
      : cloneMaterial(child.material);
  });

  return prepared;
}

function disposePreparedMaterials(model: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => materials.add(material));
    } else {
      materials.add(child.material);
    }
  });
  materials.forEach((material) => material.dispose());
}

function usePreparedModel(
  url: string,
  kind: NatureKind,
  quality: GardenQuality,
  season: GardenSeason,
  health: number,
) {
  const { scene } = useGLTF(url);
  const prepared = useMemo(
    () => prepareModel(scene, kind, quality, season, health),
    [health, kind, quality, scene, season],
  );

  useEffect(
    () => () => {
      disposePreparedMaterials(prepared);
    },
    [prepared],
  );

  return prepared;
}

function loadOptionalTree() {
  if (optionalTreePromise) return optionalTreePromise;
  if (Date.now() < optionalTreeRetryNotBefore) return Promise.resolve(null);

  const request = fetch(OPTIONAL_TREE_MODEL_URL, {
    cache: "force-cache",
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);

      return new Promise<THREE.Object3D | null>((resolve) => {
        loader.parse(
          buffer,
          OPTIONAL_TREE_MODEL_URL.slice(
            0,
            OPTIONAL_TREE_MODEL_URL.lastIndexOf("/") + 1,
          ),
          (gltf) => resolve(gltf.scene),
          () => resolve(null),
        );
      });
    })
    .catch(() => null);

  // Never poison the cache with a failed load: drop the promise so later
  // mounts retry once the cooldown elapses.
  optionalTreePromise = request.then((model) => {
    if (model) return model;
    optionalTreePromise = null;
    optionalTreeRetryNotBefore = Date.now() + OPTIONAL_TREE_RETRY_COOLDOWN_MS;
    return null;
  });

  return optionalTreePromise;
}

function useOptionalTreeModel() {
  const [tree, setTree] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadOptionalTree().then((model) => {
      if (!cancelled) setTree(model);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return tree;
}

function usePreparedOptionalModel(
  source: THREE.Object3D | null,
  quality: GardenQuality,
  season: GardenSeason,
  health: number,
  foliageAlphaMap: THREE.Texture,
) {
  const prepared = useMemo(
    () =>
      source
        ? prepareModel(
            source,
            "tree",
            quality,
            season,
            health,
            foliageAlphaMap,
          )
        : null,
    [foliageAlphaMap, health, quality, season, source],
  );

  useEffect(
    () => () => {
      if (prepared) disposePreparedMaterials(prepared);
    },
    [prepared],
  );

  return prepared;
}

export function PhotorealNature({
  seed,
  quality,
  season,
  health,
  reducedMotion,
  terrainSeed,
  surfaceOffset = -0.7,
  heroScale = 1.08,
  onHeroSelect,
}: PhotorealNatureProps) {
  const safeHealth = clamp01(health);
  const numericSeed = normalizeSeed(seed);
  const counts = BASE_COUNTS[quality];
  const seasonDensity = SEASON_DENSITY[season];
  const vitality = 0.58 + safeHealth * 0.42;
  const surfaceSampler = useMemo(
    () =>
      createPhotorealIslandSurfaceSampler({
        radius: ISLAND_RADIUS,
        quality,
        seed: terrainSeed,
      }),
    [quality, terrainSeed],
  );
  const positionOnSurface = (placement: NaturePlacement): VectorTuple => [
    placement.position[0],
    (surfaceSampler(placement.position[0], placement.position[2]) ?? 0) +
      surfaceOffset +
      placement.position[1],
    placement.position[2],
  ];

  const shrubModel = usePreparedModel(
    SHRUB_MODEL_URL,
    "shrub",
    quality,
    season,
    safeHealth,
  );
  const fernModel = usePreparedModel(
    FERN_MODEL_URL,
    "fern",
    quality,
    season,
    safeHealth,
  );
  const rockModel = usePreparedModel(
    ROCK_MODEL_URL,
    "rock",
    quality,
    season,
    safeHealth,
  );
  const treeLeafAlphaSource = useTexture(TREE_LEAF_ALPHA_URL);
  const treeLeafAlphaMap = useMemo(() => {
    const texture = treeLeafAlphaSource.clone();
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }, [treeLeafAlphaSource]);
  useEffect(() => () => treeLeafAlphaMap.dispose(), [treeLeafAlphaMap]);
  const optionalTree = useOptionalTreeModel();
  const treeModel = usePreparedOptionalModel(
    optionalTree,
    quality,
    season,
    safeHealth,
    treeLeafAlphaMap,
  );

  const shrubCount = Math.max(
    4,
    Math.round(counts.shrubs * vitality * seasonDensity.shrubs),
  );
  const fernCount = Math.max(
    season === "winter" ? 2 : 6,
    Math.round(counts.ferns * vitality * seasonDensity.ferns),
  );

  const shrubs = useMemo(
    () =>
      createClusteredPlacements({
        count: shrubCount,
        seed: numericSeed + 1103,
        innerRadius: 2.4,
        outerRadius: 9.9,
        edgeMargin: 0.9,
        pathClearance: 1.4,
        pondClearance: 0.72,
        heroClearance: 2.1,
        minDistance: 0.68,
        clusterSize: 4,
        clusterSpread: 1.35,
        minScale: 0.76,
        maxScale: 1.18,
        groundOffset: 0.015,
        maxTilt: 0.025,
      }),
    [numericSeed, shrubCount],
  );

  const ferns = useMemo(
    () =>
      createClusteredPlacements({
        count: fernCount,
        seed: numericSeed + 2909,
        innerRadius: 2.1,
        outerRadius: 10.1,
        edgeMargin: 0.72,
        pathClearance: 1.08,
        pondClearance: 0.42,
        heroClearance: 1.8,
        minDistance: 0.42,
        clusterSize: 6,
        clusterSpread: 1.12,
        minScale: 0.38,
        maxScale: 0.68,
        groundOffset: 0.012,
        maxTilt: 0.018,
      }),
    [fernCount, numericSeed],
  );

  const rocks = useMemo(
    () =>
      createClusteredPlacements({
        count: counts.rocks,
        seed: numericSeed + 4229,
        innerRadius: 3.2,
        outerRadius: 9.65,
        edgeMargin: 1.1,
        pathClearance: 1.25,
        pondClearance: 0.48,
        heroClearance: 2.3,
        minDistance: 1.5,
        clusterSize: 2,
        clusterSpread: 1.65,
        minScale: 0.17,
        maxScale: 0.3,
        groundOffset: -0.045,
        maxTilt: 0.14,
      }),
    [counts.rocks, numericSeed],
  );

  const trees = useMemo(
    () =>
      createClusteredPlacements({
        count: counts.trees,
        seed: numericSeed + 6421,
        innerRadius: 5.7,
        outerRadius: 9.15,
        edgeMargin: 1.7,
        pathClearance: 2,
        pondClearance: 1.2,
        heroClearance: 3.4,
        minDistance: 4.4,
        clusterSize: 1,
        clusterSpread: 0.35,
        minScale: 0.76,
        maxScale: 0.94,
        groundOffset: -0.025,
        maxTilt: 0.035,
      }),
    [counts.trees, numericSeed],
  );
  const heroPosition = useMemo<VectorTuple>(
    () => [
      HERO_TREE_X,
      (surfaceSampler(HERO_TREE_X, HERO_TREE_Z) ?? 0) + surfaceOffset - 0.018,
      HERO_TREE_Z,
    ],
    [surfaceOffset, surfaceSampler],
  );

  const vegetationRefs = useRef<Array<THREE.Group | null>>([]);
  const windStrength =
    reducedMotion || quality === "low" ? 0 : quality === "high" ? 0.006 : 0.004;

  useEffect(() => {
    if (windStrength > 0) return;
    vegetationRefs.current.forEach((group) => {
      if (!group) return;
      group.rotation.x = 0;
      group.rotation.z = 0;
    });
  }, [windStrength]);

  useFrame(({ clock }) => {
    if (windStrength === 0) return;
    const time = clock.elapsedTime;
    vegetationRefs.current.forEach((group, index) => {
      if (!group) return;
      const phase =
        index < shrubs.length
          ? shrubs[index]?.phase ?? 0
          : ferns[index - shrubs.length]?.phase ?? 0;
      const speed = index < shrubs.length ? 0.42 : 0.58;
      group.rotation.x =
        Math.sin(time * speed + phase) * windStrength * 0.55;
      group.rotation.z =
        Math.cos(time * speed * 0.78 + phase) * windStrength;
    });
  });

  return (
    <group name="photoreal-nature">
      {shrubs.map((placement, index) => (
        <group
          key={`shrub-${index}`}
          ref={(node) => {
            vegetationRefs.current[index] = node;
          }}
          position={positionOnSurface(placement)}
          rotation={placement.rotation}
          scale={placement.scale}
        >
          <Clone object={shrubModel} />
        </group>
      ))}

      {ferns.map((placement, index) => (
        <group
          key={`fern-${index}`}
          ref={(node) => {
            vegetationRefs.current[shrubs.length + index] = node;
          }}
          position={positionOnSurface(placement)}
          rotation={placement.rotation}
          scale={placement.scale}
        >
          <Clone object={fernModel} />
        </group>
      ))}

      {rocks.map((placement, index) => (
        <group
          key={`rock-${index}`}
          position={positionOnSurface(placement)}
          rotation={placement.rotation}
          scale={placement.scale}
        >
          <Clone object={rockModel} />
        </group>
      ))}

      {treeModel
        ? (
            <>
              <group
                name="streak-tree"
                position={heroPosition}
                rotation={[0, -0.24, 0]}
                scale={heroScale}
                onClick={(event) => {
                  event.stopPropagation();
                  onHeroSelect?.();
                }}
                onPointerOver={(event) => {
                  event.stopPropagation();
                  const target = event.nativeEvent.target;
                  if (target instanceof HTMLElement) {
                    target.style.cursor = "pointer";
                  }
                }}
                onPointerOut={(event) => {
                  event.stopPropagation();
                  const target = event.nativeEvent.target;
                  if (target instanceof HTMLElement) {
                    target.style.cursor = "grab";
                  }
                }}
              >
                <Clone object={treeModel} />
              </group>
              {trees.map((placement, index) => (
                <group
                  key={`tree-${index}`}
                  position={positionOnSurface(placement)}
                  rotation={placement.rotation}
                  scale={placement.scale}
                >
                  <Clone object={treeModel} />
                </group>
              ))}
            </>
          )
        : null}
    </group>
  );
}
