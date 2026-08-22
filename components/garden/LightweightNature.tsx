"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { GardenQuality, GardenSeason } from "./types";
import type { PhotorealIslandSurfaceSampler } from "./photoreal-geometry";

const POND_X = -2.35;
const POND_Z = 1.25;
const HERO_X = 2.62;
const HERO_Z = 0.48;

type VectorTuple = [number, number, number];

interface NaturePlacement {
  x: number;
  z: number;
  rotation: number;
  scale: number;
  shade: number;
}

interface ScatterOptions {
  count: number;
  seed: number;
  innerRadius: number;
  outerRadius: number;
  pathClearance: number;
  pondClearance: number;
  heroClearance: number;
  minDistance: number;
  minScale: number;
  maxScale: number;
}

export interface LightweightNatureProps {
  seed: number | string;
  quality: GardenQuality;
  season: GardenSeason;
  health: number;
  surfaceSampler: PhotorealIslandSurfaceSampler;
  surfaceOffset?: number;
  heroScale?: number;
  onHeroSelect?: () => void;
}

const COUNTS: Record<
  GardenQuality,
  { trees: number; shrubs: number; rocks: number }
> = {
  low: { trees: 3, shrubs: 9, rocks: 7 },
  medium: { trees: 3, shrubs: 10, rocks: 9 },
  high: { trees: 7, shrubs: 24, rocks: 14 },
};

const SEASON_FOLIAGE: Record<GardenSeason, [string, string, string]> = {
  spring: ["#53765a", "#668565", "#809676"],
  summer: ["#46694d", "#5b7b56", "#748c63"],
  autumn: ["#72684a", "#8b7a50", "#a08966"],
  winter: ["#586761", "#6c7971", "#818a81"],
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed: number | string) {
  return typeof seed === "number" && Number.isFinite(seed)
    ? Math.abs(Math.trunc(seed)) >>> 0
    : hashString(String(seed));
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

function distanceToPath(x: number, z: number) {
  return Math.abs(z + x * 0.24 + 2.3) / Math.sqrt(1 + 0.24 ** 2);
}

function isAllowed(x: number, z: number, options: ScatterOptions) {
  if (Math.hypot(x, z) > options.outerRadius) return false;
  if (Math.hypot(x, z) < options.innerRadius) return false;
  if (distanceToPath(x, z) < options.pathClearance) return false;

  const pondDistance =
    ((x - POND_X) / (2.05 + options.pondClearance)) ** 2 +
    ((z - POND_Z) / (1.35 + options.pondClearance * 0.72)) ** 2;
  if (pondDistance < 1) return false;
  if (Math.hypot(x - HERO_X, z - HERO_Z) < options.heroClearance) {
    return false;
  }
  return true;
}

function createScatter(options: ScatterOptions) {
  const random = seededRandom(options.seed);
  const placements: NaturePlacement[] = [];

  for (
    let attempt = 0;
    attempt < options.count * 100 && placements.length < options.count;
    attempt += 1
  ) {
    const angle = random() * Math.PI * 2;
    const innerSquared = options.innerRadius ** 2;
    const outerSquared = options.outerRadius ** 2;
    const radius = Math.sqrt(
      innerSquared + random() * (outerSquared - innerSquared),
    );
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (!isAllowed(x, z, options)) continue;
    if (
      placements.some(
        (placement) =>
          Math.hypot(placement.x - x, placement.z - z) < options.minDistance,
      )
    ) {
      continue;
    }

    placements.push({
      x,
      z,
      rotation: random() * Math.PI * 2,
      scale:
        options.minScale +
        random() * (options.maxScale - options.minScale),
      shade: Math.floor(random() * 3),
    });
  }

  return placements;
}

function createBranch(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radiusBottom: number,
  radiusTop: number,
  radialSegments: number,
) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(
    radiusTop,
    radiusBottom,
    length,
    radialSegments,
    1,
  );
  const orientation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  geometry.applyQuaternion(orientation);
  geometry.translate(midpoint.x, midpoint.y, midpoint.z);
  return geometry;
}

function mergeAndDispose(geometries: THREE.BufferGeometry[]) {
  const merged = mergeGeometries(geometries, false);
  if (!merged) return geometries[0];
  geometries.forEach((geometry) => geometry.dispose());
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function createHeroTrunkGeometry(quality: GardenQuality) {
  const radialSegments = quality === "high" ? 8 : 6;
  const pieces = [
    createBranch(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.12, 4.15, 0.02),
      0.46,
      0.2,
      radialSegments,
    ),
    createBranch(
      new THREE.Vector3(0.05, 2.25, 0),
      new THREE.Vector3(1.18, 3.45, 0.3),
      0.18,
      0.075,
      radialSegments,
    ),
    createBranch(
      new THREE.Vector3(0.08, 2.65, 0.02),
      new THREE.Vector3(-1.05, 3.7, -0.24),
      0.17,
      0.065,
      radialSegments,
    ),
    createBranch(
      new THREE.Vector3(0.1, 3.05, 0.02),
      new THREE.Vector3(0.46, 4.08, -0.96),
      0.15,
      0.06,
      radialSegments,
    ),
  ];
  return mergeAndDispose(pieces);
}

function addSolidColor(
  geometry: THREE.BufferGeometry,
  color: THREE.Color,
) {
  const count = geometry.getAttribute("position").count;
  const values = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    values[index * 3] = color.r;
    values[index * 3 + 1] = color.g;
    values[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
}

function createHeroCanopyGeometry(colors: THREE.Color[]) {
  const blobs: Array<{
    position: VectorTuple;
    scale: VectorTuple;
    rotation: VectorTuple;
    color: THREE.Color;
  }> = [
    {
      position: [0, 4.18, 0],
      scale: [1.48, 1.22, 1.34],
      rotation: [0.08, 0.2, -0.05],
      color: colors[1],
    },
    {
      position: [1.02, 3.82, 0.26],
      scale: [1.12, 0.96, 1.05],
      rotation: [0.04, 0.7, 0.12],
      color: colors[0],
    },
    {
      position: [-0.94, 4.02, -0.18],
      scale: [1.08, 0.98, 1.03],
      rotation: [-0.06, 1.1, -0.08],
      color: colors[2],
    },
    {
      position: [0.38, 4.38, -0.82],
      scale: [0.95, 0.86, 0.98],
      rotation: [0.1, 1.5, 0.04],
      color: colors[1],
    },
    {
      position: [-0.3, 4.72, 0.42],
      scale: [0.92, 0.84, 0.9],
      rotation: [-0.04, 0.35, 0.08],
      color: colors[2],
    },
  ];

  const geometries = blobs.map((blob) => {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    geometry.rotateX(blob.rotation[0]);
    geometry.rotateY(blob.rotation[1]);
    geometry.rotateZ(blob.rotation[2]);
    geometry.scale(blob.scale[0], blob.scale[1], blob.scale[2]);
    geometry.translate(
      blob.position[0],
      blob.position[1],
      blob.position[2],
    );
    addSolidColor(geometry, blob.color);
    return geometry;
  });
  return mergeAndDispose(geometries);
}

function VoxelHeroTree({ foliageColors }: { foliageColors: THREE.Color[] }) {
  const woodRef = useRef<THREE.InstancedMesh>(null);
  const leafRef = useRef<THREE.InstancedMesh>(null);
  const wood = useMemo<
    Array<{ position: VectorTuple; scale: VectorTuple }>
  >(
    () => [
      { position: [0, 0.42, 0], scale: [0.72, 0.84, 0.72] },
      { position: [0, 1.18, 0], scale: [0.72, 0.72, 0.72] },
      { position: [0, 1.88, 0], scale: [0.68, 0.72, 0.68] },
      { position: [0, 2.56, 0], scale: [0.64, 0.72, 0.64] },
      { position: [0.42, 3.02, 0.04], scale: [1.12, 0.46, 0.48] },
      { position: [-0.45, 3.22, -0.02], scale: [1.18, 0.44, 0.46] },
      { position: [0.08, 3.18, -0.42], scale: [0.46, 0.44, 1.08] },
    ],
    [],
  );
  const leaves = useMemo<
    Array<{ position: VectorTuple; scale: VectorTuple; shade: number }>
  >(
    () => [
      { position: [0, 4.05, 0], scale: [2.1, 1.05, 1.8], shade: 1 },
      {
        position: [1.25, 3.75, 0.18],
        scale: [1.45, 1, 1.35],
        shade: 0,
      },
      {
        position: [-1.2, 3.92, -0.12],
        scale: [1.5, 1.08, 1.35],
        shade: 2,
      },
      {
        position: [0.08, 3.82, -1.05],
        scale: [1.45, 0.95, 1.25],
        shade: 0,
      },
      {
        position: [0.18, 4.62, 0.18],
        scale: [1.5, 0.82, 1.3],
        shade: 2,
      },
      {
        position: [1.62, 4.2, 0.12],
        scale: [0.8, 0.76, 0.86],
        shade: 1,
      },
      {
        position: [-1.62, 4.25, -0.14],
        scale: [0.78, 0.72, 0.82],
        shade: 0,
      },
    ],
    [],
  );

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();

    wood.forEach((piece, index) => {
      dummy.position.set(...piece.position);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(...piece.scale);
      dummy.updateMatrix();
      woodRef.current?.setMatrixAt(index, dummy.matrix);
      woodRef.current?.setColorAt(
        index,
        new THREE.Color(index % 3 === 0 ? "#654a35" : "#563c2c"),
      );
    });

    leaves.forEach((piece, index) => {
      dummy.position.set(...piece.position);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(...piece.scale);
      dummy.updateMatrix();
      leafRef.current?.setMatrixAt(index, dummy.matrix);
      leafRef.current?.setColorAt(
        index,
        foliageColors[piece.shade % foliageColors.length],
      );
    });

    for (const mesh of [woodRef.current, leafRef.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [foliageColors, leaves, wood]);

  return (
    <>
      <instancedMesh
        ref={woodRef}
        args={[undefined, undefined, wood.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.98} />
      </instancedMesh>
      <instancedMesh
        ref={leafRef}
        args={[undefined, undefined, leaves.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.94} />
      </instancedMesh>
    </>
  );
}

export function LightweightNature({
  seed,
  quality,
  season,
  health,
  surfaceSampler,
  surfaceOffset = -0.7,
  heroScale = 1.08,
  onHeroSelect,
}: LightweightNatureProps) {
  const safeHealth = clamp01(health);
  const numericSeed = normalizeSeed(seed);
  const counts = COUNTS[quality];
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const canopyRef = useRef<THREE.InstancedMesh>(null);
  const shrubRef = useRef<THREE.InstancedMesh>(null);
  const rockRef = useRef<THREE.InstancedMesh>(null);
  const foliageColors = useMemo(
    () =>
      SEASON_FOLIAGE[season].map((value) => {
        const color = new THREE.Color(value);
        color.lerp(new THREE.Color("#776e53"), (1 - safeHealth) * 0.26);
        return color;
      }),
    [safeHealth, season],
  );
  const trunkColors = useMemo(
    () => [
      new THREE.Color("#514238"),
      new THREE.Color("#5b493b"),
      new THREE.Color("#665244"),
    ],
    [],
  );
  const rockColors = useMemo(
    () => [
      new THREE.Color("#6f716c"),
      new THREE.Color("#7c7b73"),
      new THREE.Color("#5f655f"),
    ],
    [],
  );
  const trees = useMemo(
    () =>
      createScatter({
        count: counts.trees,
        seed: numericSeed + 101,
        innerRadius: 4,
        outerRadius: 9.55,
        pathClearance: 1.45,
        pondClearance: 0.9,
        heroClearance: 3,
        minDistance: 2.45,
        minScale: 0.82,
        maxScale: 1.12,
      }),
    [counts.trees, numericSeed],
  );
  const shrubs = useMemo(
    () =>
      createScatter({
        count: counts.shrubs,
        seed: numericSeed + 607,
        innerRadius: 2,
        outerRadius: 10,
        pathClearance: 0.78,
        pondClearance: 0.3,
        heroClearance: 1.75,
        minDistance: 0.85,
        minScale: 0.34,
        maxScale: 0.7,
      }),
    [counts.shrubs, numericSeed],
  );
  const rocks = useMemo(
    () =>
      createScatter({
        count: counts.rocks,
        seed: numericSeed + 1297,
        innerRadius: 2.8,
        outerRadius: 10.15,
        pathClearance: 0.92,
        pondClearance: 0.16,
        heroClearance: 1.9,
        minDistance: 1.05,
        minScale: 0.24,
        maxScale: 0.58,
      }),
    [counts.rocks, numericSeed],
  );
  const canopyCount = trees.length * 3;
  const heroGroundY =
    (surfaceSampler(HERO_X, HERO_Z) ?? 0) + surfaceOffset - 0.02;
  const heroTrunkGeometry = useMemo(
    () => createHeroTrunkGeometry(quality),
    [quality],
  );
  const heroCanopyGeometry = useMemo(
    () => createHeroCanopyGeometry(foliageColors),
    [foliageColors],
  );

  useEffect(
    () => () => {
      heroTrunkGeometry.dispose();
      heroCanopyGeometry.dispose();
    },
    [heroCanopyGeometry, heroTrunkGeometry],
  );

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();

    trees.forEach((tree, index) => {
      const groundY =
        (surfaceSampler(tree.x, tree.z) ?? 0) + surfaceOffset;
      dummy.position.set(tree.x, groundY + tree.scale * 1.26, tree.z);
      dummy.rotation.set(0, tree.rotation, 0);
      dummy.scale.set(
        tree.scale * 0.48,
        tree.scale * 1.26,
        tree.scale * 0.48,
      );
      dummy.updateMatrix();
      trunkRef.current?.setMatrixAt(index, dummy.matrix);
      trunkRef.current?.setColorAt(index, trunkColors[tree.shade]);

      const offsets: Array<{
        x: number;
        y: number;
        z: number;
        scale: VectorTuple;
      }> = [
        { x: 0, y: 2.72, z: 0, scale: [1.08, 1.12, 1] },
        { x: 0.58, y: 2.48, z: 0.16, scale: [0.82, 0.88, 0.78] },
        { x: -0.5, y: 2.58, z: -0.18, scale: [0.78, 0.84, 0.76] },
      ];

      offsets.forEach((offset, offsetIndex) => {
        const cosine = Math.cos(tree.rotation);
        const sine = Math.sin(tree.rotation);
        const instanceIndex = index * offsets.length + offsetIndex;
        dummy.position.set(
          tree.x + (offset.x * cosine - offset.z * sine) * tree.scale,
          groundY + offset.y * tree.scale,
          tree.z + (offset.x * sine + offset.z * cosine) * tree.scale,
        );
        dummy.rotation.set(
          offsetIndex * 0.08,
          tree.rotation + offsetIndex * 0.72,
          offsetIndex % 2 ? 0.06 : -0.04,
        );
        dummy.scale.set(
          offset.scale[0] * tree.scale,
          offset.scale[1] * tree.scale,
          offset.scale[2] * tree.scale,
        );
        dummy.updateMatrix();
        canopyRef.current?.setMatrixAt(instanceIndex, dummy.matrix);
        canopyRef.current?.setColorAt(
          instanceIndex,
          foliageColors[(tree.shade + offsetIndex) % foliageColors.length],
        );
      });
    });

    shrubs.forEach((shrub, index) => {
      const groundY =
        (surfaceSampler(shrub.x, shrub.z) ?? 0) + surfaceOffset;
      dummy.position.set(shrub.x, groundY + shrub.scale * 0.52, shrub.z);
      dummy.rotation.set(
        quality === "medium" ? 0 : shrub.rotation * 0.08,
        quality === "medium"
          ? Math.round(shrub.rotation / (Math.PI / 2)) * (Math.PI / 2)
          : shrub.rotation,
        quality === "medium" ? 0 : (shrub.shade - 1) * 0.06,
      );
      dummy.scale.set(
        shrub.scale * 1.15,
        shrub.scale * 0.72,
        shrub.scale,
      );
      dummy.updateMatrix();
      shrubRef.current?.setMatrixAt(index, dummy.matrix);
      shrubRef.current?.setColorAt(index, foliageColors[shrub.shade]);
    });

    rocks.forEach((rock, index) => {
      const groundY =
        (surfaceSampler(rock.x, rock.z) ?? 0) + surfaceOffset;
      dummy.position.set(rock.x, groundY + rock.scale * 0.2, rock.z);
      dummy.rotation.set(
        quality === "medium" ? 0 : rock.rotation * 0.13,
        quality === "medium"
          ? Math.round(rock.rotation / (Math.PI / 2)) * (Math.PI / 2)
          : rock.rotation,
        quality === "medium" ? 0 : (rock.shade - 1) * 0.16,
      );
      dummy.scale.set(
        rock.scale,
        rock.scale * 0.54,
        rock.scale * 0.82,
      );
      dummy.updateMatrix();
      rockRef.current?.setMatrixAt(index, dummy.matrix);
      rockRef.current?.setColorAt(index, rockColors[rock.shade]);
    });

    for (const mesh of [
      trunkRef.current,
      canopyRef.current,
      shrubRef.current,
      rockRef.current,
    ]) {
      if (!mesh) continue;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [
    foliageColors,
    quality,
    rockColors,
    rocks,
    shrubs,
    surfaceOffset,
    surfaceSampler,
    trees,
    trunkColors,
  ]);

  return (
    <group name="lightweight-nature">
      <instancedMesh
        ref={trunkRef}
        args={[undefined, undefined, trees.length]}
        castShadow={quality === "high"}
        receiveShadow={quality === "high"}
      >
        <cylinderGeometry args={[0.38, 0.58, 2, 10, 1]} />
        <meshBasicMaterial
          toneMapped={false}
        />
      </instancedMesh>

      <instancedMesh
        ref={canopyRef}
        args={[undefined, undefined, canopyCount]}
        castShadow={quality === "high"}
        receiveShadow={quality === "high"}
      >
        <icosahedronGeometry args={[1, 2]} />
        <meshBasicMaterial
          toneMapped={false}
        />
      </instancedMesh>

      <instancedMesh
        ref={shrubRef}
        args={[undefined, undefined, shrubs.length]}
        castShadow={quality === "high"}
        receiveShadow={quality === "high"}
      >
        {quality === "medium" ? (
          <boxGeometry args={[1, 1, 1]} />
        ) : (
          <icosahedronGeometry args={[1, 1]} />
        )}
        {quality === "medium" ? (
          <meshStandardMaterial roughness={0.96} />
        ) : (
          <meshBasicMaterial toneMapped={false} />
        )}
      </instancedMesh>

      <instancedMesh
        ref={rockRef}
        args={[undefined, undefined, rocks.length]}
        castShadow={quality === "high"}
        receiveShadow
      >
        {quality === "medium" ? (
          <boxGeometry args={[1, 1, 1]} />
        ) : (
          <dodecahedronGeometry args={[1, 0]} />
        )}
        <meshStandardMaterial
          flatShading
          roughness={1}
        />
      </instancedMesh>

      <group
        name="streak-tree"
        position={[HERO_X, heroGroundY, HERO_Z]}
        rotation={[0, -0.24, 0]}
        scale={heroScale}
        onClick={(event) => {
          event.stopPropagation();
          onHeroSelect?.();
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          const target = event.nativeEvent.target;
          if (target instanceof HTMLElement) target.style.cursor = "pointer";
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          const target = event.nativeEvent.target;
          if (target instanceof HTMLElement) target.style.cursor = "grab";
        }}
      >
        {quality === "medium" ? (
          <VoxelHeroTree foliageColors={foliageColors} />
        ) : (
          <>
            <mesh
              geometry={heroTrunkGeometry}
              castShadow={quality !== "low"}
              receiveShadow
            >
              <meshBasicMaterial color="#57463a" toneMapped={false} />
            </mesh>
            <mesh
              geometry={heroCanopyGeometry}
              castShadow={quality !== "low"}
              receiveShadow
            >
              <meshBasicMaterial toneMapped={false} vertexColors />
            </mesh>
          </>
        )}
      </group>
    </group>
  );
}
