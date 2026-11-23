"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { PhotorealIslandSurfaceSampler } from "../photoreal-geometry";
import type {
  GardenDay,
  GardenQuality,
  GardenSeason,
  GardenSelection,
  GardenStats,
  GardenWeather,
} from "../types";
import {
  createFloraLayout,
  createMeadowBeds,
  type FloraCircle,
  type FloraLayout,
  type Wildflower,
} from "./flora-layout";
import { ISLAND_SURFACE_OFFSET } from "./Island";
import type { GardenLayout } from "./mapping";
import type { WorldPalette } from "./palette";
import type { TierSettings } from "./tiers";

export interface FloraProps {
  layout: GardenLayout;
  palette: WorldPalette;
  tier: TierSettings;
  /** Sway is off on low. */
  quality: GardenQuality;
  season: GardenSeason;
  weather: GardenWeather;
  reducedMotion: boolean;
  seed: number;
  stats: GardenStats;
  days: GardenDay[];
  surfaceSampler: PhotorealIslandSurfaceSampler;
  /** Circles along the waterfall's outflow channel. */
  channel: ReadonlyArray<FloraCircle>;
  onSelect?: (selection: GardenSelection | null) => void;
}

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
/** Blobs in one lupine spike, bottom to tip. */
const SPIKE_BLOBS = 8;
/** Share of a lupine stem the flower spike covers. */
const SPIKE_SHARE = 0.5;

const smoothstep = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Cheap deterministic hash noise in -1..1 for a vertex position. */
const hashNoise = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * A flat stepping stone: an irregular, softly bevelled slab of radius 1 and
 * height about 1 (scaled flat per instance). Tops are pale, sides darker.
 */
function createStoneGeometry() {
  const segments = 11;
  // [radius, y, shade] from the underside up to the crown.
  const rings: [number, number, number][] = [
    [0.86, -0.5, 0.62],
    [1.0, 0.05, 0.8],
    [0.95, 0.38, 0.94],
    [0.78, 0.5, 1.0],
  ];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const edge = (angle: number) =>
    1 +
    0.09 * Math.sin(angle * 2 + 0.6) +
    0.06 * Math.sin(angle * 3 + 2.1) +
    0.04 * Math.sin(angle * 5 + 4.2);
  for (const [radius, y, shade] of rings) {
    for (let s = 0; s < segments; s += 1) {
      const angle = (s / segments) * TAU;
      const r = radius * edge(angle);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const speck = shade >= 0.94 ? hashNoise(x, y, z) * 0.05 : 0;
      positions.push(x, y + (shade >= 0.94 ? 0.03 * Math.sin(angle * 3) : 0), z);
      colors.push(shade + speck, shade + speck, shade + speck);
    }
  }
  const top = positions.length / 3;
  positions.push(0, 0.54, 0);
  colors.push(1.02, 1.02, 1.02);
  const bottom = top + 1;
  positions.push(0, -0.5, 0);
  colors.push(0.6, 0.6, 0.6);
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = ring * segments + s;
      const b = ring * segments + ((s + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      indices.push(a, c, b, b, c, d);
    }
  }
  const crown = (rings.length - 1) * segments;
  for (let s = 0; s < segments; s += 1) {
    indices.push(crown + s, top, crown + ((s + 1) % segments));
    indices.push(s, (s + 1) % segments, bottom);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A unit stem: base at y = 0, height 1, slightly tapered. */
function createStemGeometry() {
  const geometry = new THREE.CylinderGeometry(0.6, 1, 1, 5, 2, true);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

/**
 * A round flower head of radius 1: a ring of cupped petals around a domed
 * centre. Petals are white in the vertex colours (so they take the instance
 * colour); the centre is a warm gold tint.
 */
function createHeadGeometry() {
  const petals = 6;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const centre: [number, number, number] = [1, 0.72, 0.22];
  const push = (x: number, y: number, z: number, c: readonly number[]) => {
    positions.push(x, y, z);
    colors.push(c[0], c[1], c[2]);
    return positions.length / 3 - 1;
  };
  const white = [1, 1, 1];
  for (let p = 0; p < petals; p += 1) {
    const angle = (p / petals) * TAU;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const sx = -dz;
    const sz = dx;
    const base = push(dx * 0.2, 0.06, dz * 0.2, white);
    const left = push(dx * 0.6 + sx * 0.3, 0.14, dz * 0.6 + sz * 0.3, white);
    const right = push(dx * 0.6 - sx * 0.3, 0.14, dz * 0.6 - sz * 0.3, white);
    const tip = push(dx * 1.0, 0.1, dz * 1.0, white);
    const under = push(dx * 0.55, 0.0, dz * 0.55, [0.85, 0.85, 0.85]);
    indices.push(base, left, tip, base, tip, right);
    indices.push(base, under, left, base, right, under, left, under, tip, under, right, tip);
  }
  // Domed centre.
  const ringCount = 7;
  const apex = push(0, 0.26, 0, centre);
  const ring: number[] = [];
  for (let k = 0; k < ringCount; k += 1) {
    const angle = (k / ringCount) * TAU;
    ring.push(push(Math.cos(angle) * 0.3, 0.12, Math.sin(angle) * 0.3, centre.map((v) => v * 0.85)));
  }
  for (let k = 0; k < ringCount; k += 1) {
    indices.push(apex, ring[(k + 1) % ringCount], ring[k]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Light the petals as if they faced the sky so both sides read bright.
  const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < normals.count; i += 1) {
    n.fromBufferAttribute(normals, i);
    if (n.y < 0) n.y = -n.y;
    n.lerp(UP, 0.55).normalize();
    normals.setXYZ(i, n.x, n.y, n.z);
  }
  return geometry;
}

/** A soft round blob for lupine spikes. */
function createSpikeBlobGeometry(detail: number) {
  return new THREE.IcosahedronGeometry(1, detail);
}

/**
 * A lumpy, flat-bottomed shrub blob with a baked dark-underside to sunlit-top
 * gradient, and `aCap` marking its crown (snow in winter).
 */
function createShrubGeometry(detail: number) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute("normal");
  ico.deleteAttribute("uv");
  const geometry = mergeVertices(ico);
  ico.dispose();
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const cap = new Float32Array(position.count);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const lump =
      1 +
      0.06 * Math.sin(x * 4.1 + 0.3) * Math.sin(y * 3.7 + 1.1) +
      0.05 * Math.sin(z * 4.3 + 0.9) * Math.cos(x * 3.2 - 0.4) +
      0.03 * Math.sin((x + z) * 7.1 + y * 5.3);
    const flatY = y < 0 ? y * 0.7 : y;
    position.setXYZ(i, x * lump, flatY * lump, z * lump);
    const t = (y + 1) / 2;
    const shade = 0.62 + 0.52 * Math.pow(t, 0.9);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
    cap[i] = smoothstep(0.45, 0.8, y);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aCap", new THREE.BufferAttribute(cap, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A faceted boulder of radius 1 with a flattened base. Non-indexed so it
 * shades flat; `aCap` marks the upward-facing facets for the moss (or snow)
 * cap, broken up a little so the edge isn't a clean line.
 */
function createRockGeometry() {
  const ico = new THREE.IcosahedronGeometry(1, 1);
  ico.deleteAttribute("normal");
  ico.deleteAttribute("uv");
  const indexed = mergeVertices(ico);
  ico.dispose();
  const position = indexed.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const jitter = 1 + 0.16 * hashNoise(x, y, z);
    const ny = Math.max(-0.45, y * jitter);
    position.setXYZ(i, x * jitter, ny, z * jitter);
  }
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  const flatPosition = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const colors = new Float32Array(flatPosition.count * 3);
  const cap = new Float32Array(flatPosition.count);
  for (let face = 0; face < flatPosition.count / 3; face += 1) {
    const i = face * 3;
    const ny = normal.getY(i);
    const cy =
      (flatPosition.getY(i) + flatPosition.getY(i + 1) + flatPosition.getY(i + 2)) / 3;
    const noise = hashNoise(face * 0.37, cy, face * 1.31);
    const moss = smoothstep(0.12, 0.5, ny + noise * 0.18) * smoothstep(-0.2, 0.2, cy);
    const shade = 0.92 + noise * 0.07 + Math.max(0, ny) * 0.08;
    for (let k = 0; k < 3; k += 1) {
      colors[(i + k) * 3] = shade;
      colors[(i + k) * 3 + 1] = shade;
      colors[(i + k) * 3 + 2] = shade;
      cap[i + k] = moss;
    }
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aCap", new THREE.BufferAttribute(cap, 1));
  return geometry;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

interface CapUniforms {
  uCapColor: { value: THREE.Color };
  uCapAmount: { value: number };
}

/** Lit material that tints `aCap` vertices toward a cap colour (moss or snow). */
function createCappedMaterial(flatShading: boolean, key: string) {
  const uniforms: CapUniforms = {
    uCapColor: { value: new THREE.Color("#ffffff") },
    uCapAmount: { value: 0 },
  };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: flatShading ? 0.95 : 0.86,
    metalness: 0,
    flatShading,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float aCap;
uniform vec3 uCapColor;
uniform float uCapAmount;
${shader.vertexShader}`.replace(
      "#include <color_vertex>",
      `#include <color_vertex>
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor.rgb = mix(vColor.rgb, uCapColor * (0.9 + 0.1 * color.r), aCap * uCapAmount);
#endif`,
    );
  };
  material.customProgramCacheKey = () => `garden-capped-${key}`;
  material.userData.uniforms = uniforms;
  return material;
}

interface SwayUniforms {
  uTime: { value: number };
  uSway: { value: number };
}

/**
 * Lit flower material with a gentle wind sway in the vertex shader. Per
 * instance, `aSway` is how far that point sits up a bending stem (in world
 * units, already squared out along the stem), so heads and spikes follow
 * their stems. Stems scale it by their own local height.
 */
function createFlowerMaterial(kind: "stem" | "head" | "spike") {
  const uniforms: SwayUniforms = { uTime: { value: 0 }, uSway: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: kind === "head",
    roughness: kind === "stem" ? 0.85 : 0.7,
    metalness: 0,
    side: kind === "head" ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float aSway;
uniform float uTime;
uniform float uSway;
${shader.vertexShader}`.replace(
      "#include <project_vertex>",
      `vec4 mvPosition = vec4( transformed, 1.0 );
vec2 swayRoot = vec2( 0.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  swayRoot = instanceMatrix[3].xz;
#endif
  float swayH = ${kind === "stem" ? "position.y * position.y * aSway" : "aSway"};
  float wave = sin(uTime * 1.7 + swayRoot.x * 0.9 + swayRoot.y * 0.7)
    + 0.35 * sin(uTime * 3.1 + swayRoot.x * 1.7 - swayRoot.y * 0.4);
  mvPosition.x += wave * swayH * uSway;
  mvPosition.z += cos(uTime * 1.3 + swayRoot.y * 0.8 + swayRoot.x * 0.3) * swayH * uSway * 0.6;
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`,
    );
    if (kind !== "stem") {
      // A touch of self-light so blooms still pop in shade.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * 0.14;`,
      );
    }
  };
  material.customProgramCacheKey = () => `garden-flower-${kind}`;
  material.userData.uniforms = uniforms;
  return material;
}

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

interface Batch {
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
  /** Flower index per instance (flower batches only). */
  owners: number[];
  sway: number[];
}

const emptyBatch = (): Batch => ({ matrices: [], colors: [], owners: [], sway: [] });

interface FloraInstances {
  stones: Batch;
  stems: Batch;
  heads: Batch;
  spikes: Batch;
  shrubs: Batch;
  rocks: Batch;
  /** Ground height under each flower. */
  flowerGround: number[];
}

function groundAt(sampler: PhotorealIslandSurfaceSampler, x: number, z: number) {
  return (sampler(x, z) ?? 0) + ISLAND_SURFACE_OFFSET;
}

/** Terrain normal from central differences. */
function groundNormal(sampler: PhotorealIslandSurfaceSampler, x: number, z: number, step: number) {
  const hL = sampler(x - step, z) ?? sampler(x, z) ?? 0;
  const hR = sampler(x + step, z) ?? sampler(x, z) ?? 0;
  const hD = sampler(x, z - step) ?? sampler(x, z) ?? 0;
  const hU = sampler(x, z + step) ?? sampler(x, z) ?? 0;
  return new THREE.Vector3(hL - hR, 2 * step, hD - hU).normalize();
}

function compose(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  scale: THREE.Vector3,
) {
  return new THREE.Matrix4().compose(position, quaternion, scale);
}

function buildInstances(
  flora: FloraLayout,
  palette: WorldPalette,
  season: GardenSeason,
  sampler: PhotorealIslandSurfaceSampler,
): FloraInstances {
  const c = (hex: string) => new THREE.Color(hex);
  const stones = emptyBatch();
  const stems = emptyBatch();
  const heads = emptyBatch();
  const spikes = emptyBatch();
  const shrubs = emptyBatch();
  const rocks = emptyBatch();
  const flowerGround: number[] = [];
  const yawQ = new THREE.Quaternion();
  const tiltQ = new THREE.Quaternion();

  // Stepping stones: pale slabs, slightly sunk and following the slope.
  const stone = c(palette.stone);
  const stoneLight = c(palette.stoneLight);
  for (const s of flora.stones) {
    const thickness = 0.13 + s.tint * 0.04;
    const y = groundAt(sampler, s.x, s.z) + 0.035 - thickness * 0.5;
    tiltQ.setFromUnitVectors(UP, groundNormal(sampler, s.x, s.z, 0.35));
    yawQ.setFromAxisAngle(UP, s.rotation);
    stones.matrices.push(
      compose(
        new THREE.Vector3(s.x, y, s.z),
        tiltQ.clone().multiply(yawQ),
        new THREE.Vector3(s.length, thickness, s.width),
      ),
    );
    stones.colors.push(
      stoneLight.clone().lerp(stone, s.tint * 0.4).offsetHSL(0, -0.02, (s.tint - 0.5) * 0.04),
    );
  }

  // Wildflowers: a stem plus a round head, or a stacked lupine spike.
  const greens = palette.foliage.map(c);
  const stemGreen =
    season === "autumn"
      ? c(palette.evergreen[0]).lerp(c(palette.grassDry), 0.35)
      : season === "winter"
        ? c(palette.evergreen[1]).lerp(c(palette.grassDry), 0.3)
        : greens[1].clone().lerp(greens[0], 0.3);
  const flowerColours = palette.flowers.map(c);
  const shorten = season === "winter" ? 0.7 : 1;
  flora.flowers.forEach((flower: Wildflower, index) => {
    const ground = groundAt(sampler, flower.x, flower.z) - 0.02;
    flowerGround.push(ground);
    const height = flower.height * shorten;
    stems.matrices.push(
      compose(
        new THREE.Vector3(flower.x, ground, flower.z),
        yawQ.setFromAxisAngle(UP, flower.rotation).clone(),
        new THREE.Vector3(flower.variant === 0 ? 0.016 : 0.012, height, flower.variant === 0 ? 0.016 : 0.012),
      ),
    );
    stems.colors.push(stemGreen.clone().offsetHSL(0, 0, (flower.tint - 0.5) * 0.06));
    stems.owners.push(index);
    stems.sway.push(height);

    const colour = flowerColours[flower.variant]
      .clone()
      .offsetHSL((flower.tint - 0.5) * 0.03, 0, (flower.tint - 0.5) * 0.06);
    if (flower.variant === 0) {
      // Lupine: blobs shrinking toward the tip, lighter as they go.
      const spikeStart = height * (1 - SPIKE_SHARE);
      const tipColour = colour.clone().lerp(new THREE.Color("#ffffff"), 0.45);
      const deep = colour.clone().offsetHSL(0, 0.05, -0.04);
      for (let k = 0; k < SPIKE_BLOBS; k += 1) {
        const t = k / (SPIKE_BLOBS - 1);
        const h = spikeStart + (height - spikeStart + flower.head * 0.6) * t;
        const radius = flower.head * (1 - 0.6 * t);
        spikes.matrices.push(
          compose(
            new THREE.Vector3(flower.x, ground + h, flower.z),
            yawQ.setFromAxisAngle(UP, flower.rotation + k * 2.4).clone(),
            new THREE.Vector3(radius, radius * 0.85, radius),
          ),
        );
        spikes.colors.push(deep.clone().lerp(tipColour, t));
        spikes.owners.push(index);
        spikes.sway.push((h * h) / height);
      }
    } else {
      const tilt = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.18 * Math.cos(flower.rotation), flower.rotation, 0.18 * Math.sin(flower.rotation)),
      );
      heads.matrices.push(
        compose(
          new THREE.Vector3(flower.x, ground + height, flower.z),
          tilt,
          new THREE.Vector3(flower.head, flower.head, flower.head),
        ),
      );
      heads.colors.push(colour);
      heads.owners.push(index);
      heads.sway.push(height);
    }
  });

  // Shrubs: 2-3 lumpy blobs in the season's foliage.
  for (const shrub of flora.shrubs) {
    const ground = groundAt(sampler, shrub.x, shrub.z) - 0.06;
    const base = greens[shrub.colour]
      .clone()
      .offsetHSL((shrub.tint - 0.5) * 0.05, 0.04, (shrub.tint - 0.5) * 0.06);
    const light = greens[Math.min(3, shrub.colour + 1)];
    const cos = Math.cos(shrub.rotation);
    const sin = Math.sin(shrub.rotation);
    shrub.blobs.forEach((blob, k) => {
      shrubs.matrices.push(
        compose(
          new THREE.Vector3(
            shrub.x + blob.dx * cos - blob.dz * sin,
            ground + blob.dy,
            shrub.z + blob.dx * sin + blob.dz * cos,
          ),
          yawQ.setFromAxisAngle(UP, shrub.rotation + k * 1.7).clone(),
          new THREE.Vector3(blob.radius, blob.radius * 0.9, blob.radius),
        ),
      );
      shrubs.colors.push(base.clone().lerp(light, k === 0 ? 0.25 : 0.1));
    });
  }

  // Rocks: pale grey boulders, partly buried.
  const rockBase = c(palette.stoneLight).lerp(new THREE.Color("#c4c7c3"), 0.55);
  for (const rock of flora.rocks) {
    const height = rock.size * rock.squash;
    const ground = groundAt(sampler, rock.x, rock.z);
    tiltQ.setFromEuler(new THREE.Euler(rock.tiltX, rock.rotation, rock.tiltZ));
    rocks.matrices.push(
      compose(
        new THREE.Vector3(rock.x, ground + height * 0.18, rock.z),
        tiltQ.clone(),
        new THREE.Vector3(rock.size * rock.stretch, height, rock.size / rock.stretch),
      ),
    );
    rocks.colors.push(rockBase.clone().offsetHSL(0, 0, (rock.tint - 0.5) * 0.08));
  }

  return { stones, stems, heads, spikes, shrubs, rocks, flowerGround };
}

function withSway(base: THREE.BufferGeometry, batch: Batch) {
  const geometry = base.clone();
  const array = new Float32Array(Math.max(1, batch.sway.length));
  array.set(batch.sway);
  geometry.setAttribute("aSway", new THREE.InstancedBufferAttribute(array, 1));
  return geometry;
}

function applyBatch(mesh: THREE.InstancedMesh | null, batch: Batch) {
  if (!mesh) return;
  batch.matrices.forEach((matrix, index) => {
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, batch.colors[index]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function capUniforms(mesh: THREE.InstancedMesh | null) {
  if (!mesh) return null;
  return ((mesh.material as THREE.Material).userData.uniforms as CapUniforms | undefined) ?? null;
}

function swayUniforms(mesh: THREE.InstancedMesh | null) {
  if (!mesh) return null;
  return ((mesh.material as THREE.Material).userData.uniforms as SwayUniforms | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Stepping stones, wildflowers, shrubs and mossy rocks. Six instanced draw
 * calls in all; the only per-frame work is the flowers' sway uniforms.
 */
export function Flora({
  layout,
  palette,
  tier,
  quality,
  season,
  weather,
  reducedMotion,
  seed,
  stats,
  days,
  surfaceSampler,
  channel,
  onSelect,
}: FloraProps) {
  const stoneRef = useRef<THREE.InstancedMesh>(null);
  const stemRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const spikeRef = useRef<THREE.InstancedMesh>(null);
  const shrubRef = useRef<THREE.InstancedMesh>(null);
  const rockRef = useRef<THREE.InstancedMesh>(null);
  const swayLevel = useRef(0);

  const meadow = useMemo(() => createMeadowBeds(days), [days]);

  // Key the placement on rounded tree positions so timeline playback only
  // reshuffles flora when a tree actually appears or moves.
  const treeKey = layout.yearTrees
    .map((t) => `${t.x.toFixed(2)},${t.z.toFixed(2)}`)
    .join("|");
  const greatScale = Math.round(layout.greatTree.scale * 10) / 10;
  const { islandRadius, flowerCount, shrubCount, rockCount } = layout;
  const { x: pondX, z: pondZ, scale: pondScale } = layout.pond;
  const { x: greatX, z: greatZ } = layout.greatTree;
  const flora = useMemo(
    () =>
      createFloraLayout({
        layout: {
          islandRadius,
          pond: { x: pondX, z: pondZ, scale: pondScale },
          flowerCount,
          shrubCount,
          rockCount,
          greatTree: { x: greatX, z: greatZ, scale: greatScale },
          yearTrees: treeKey
            ? treeKey.split("|").map((entry) => {
                const [x, z] = entry.split(",").map(Number);
                return { x, z };
              })
            : [],
        },
        channel,
        meadow,
        onIsland: (x, z) => surfaceSampler(x, z) !== null,
        seed,
      }),
    [
      channel,
      flowerCount,
      greatScale,
      greatX,
      greatZ,
      islandRadius,
      meadow,
      pondScale,
      pondX,
      pondZ,
      rockCount,
      seed,
      shrubCount,
      surfaceSampler,
      treeKey,
    ],
  );

  const instances = useMemo(
    () => buildInstances(flora, palette, season, surfaceSampler),
    [flora, palette, season, surfaceSampler],
  );

  const stoneGeometry = useMemo(() => createStoneGeometry(), []);
  const stemBase = useMemo(() => createStemGeometry(), []);
  const headBase = useMemo(() => createHeadGeometry(), []);
  const spikeBase = useMemo(() => createSpikeBlobGeometry(quality === "low" ? 0 : 1), [quality]);
  const shrubGeometry = useMemo(() => createShrubGeometry(quality === "low" ? 1 : 2), [quality]);
  const rockGeometry = useMemo(() => createRockGeometry(), []);
  const stemGeometry = useMemo(() => withSway(stemBase, instances.stems), [stemBase, instances.stems]);
  const headGeometry = useMemo(() => withSway(headBase, instances.heads), [headBase, instances.heads]);
  const spikeGeometry = useMemo(
    () => withSway(spikeBase, instances.spikes),
    [spikeBase, instances.spikes],
  );

  const stoneMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
    [],
  );
  const stemMaterial = useMemo(() => createFlowerMaterial("stem"), []);
  const headMaterial = useMemo(() => createFlowerMaterial("head"), []);
  const spikeMaterial = useMemo(() => createFlowerMaterial("spike"), []);
  const shrubMaterial = useMemo(() => createCappedMaterial(false, "shrub"), []);
  const rockMaterial = useMemo(() => createCappedMaterial(true, "rock"), []);

  useEffect(() => () => stemGeometry.dispose(), [stemGeometry]);
  useEffect(() => () => headGeometry.dispose(), [headGeometry]);
  useEffect(() => () => spikeGeometry.dispose(), [spikeGeometry]);
  useEffect(() => () => spikeBase.dispose(), [spikeBase]);
  useEffect(() => () => shrubGeometry.dispose(), [shrubGeometry]);
  useEffect(
    () => () => {
      stoneGeometry.dispose();
      stemBase.dispose();
      headBase.dispose();
      rockGeometry.dispose();
      stoneMaterial.dispose();
      stemMaterial.dispose();
      headMaterial.dispose();
      spikeMaterial.dispose();
      shrubMaterial.dispose();
      rockMaterial.dispose();
    },
    [
      headBase,
      headMaterial,
      rockGeometry,
      rockMaterial,
      shrubMaterial,
      spikeMaterial,
      stemBase,
      stemMaterial,
      stoneGeometry,
      stoneMaterial,
    ],
  );

  useLayoutEffect(() => {
    applyBatch(stoneRef.current, instances.stones);
    applyBatch(stemRef.current, instances.stems);
    applyBatch(headRef.current, instances.heads);
    applyBatch(spikeRef.current, instances.spikes);
    applyBatch(shrubRef.current, instances.shrubs);
    applyBatch(rockRef.current, instances.rocks);
  }, [instances]);

  // Moss on rocks (snow in winter); snow on shrub crowns in winter only.
  const snow = palette.snow;
  const moss = palette.evergreen[1];
  const grass = palette.grass[1];
  useLayoutEffect(() => {
    const rockUniforms = capUniforms(rockRef.current);
    if (rockUniforms) {
      rockUniforms.uCapColor.value.set(snow ?? grass).lerp(new THREE.Color(snow ?? moss), 0.45);
      rockUniforms.uCapAmount.value = snow ? 0.92 : 0.9;
    }
    const shrubUniforms = capUniforms(shrubRef.current);
    if (shrubUniforms) {
      shrubUniforms.uCapColor.value.set(snow ?? "#ffffff");
      shrubUniforms.uCapAmount.value = snow ? 0.75 : 0;
    }
  }, [grass, instances, moss, snow]);

  const swayEnabled = !reducedMotion && quality !== "low";
  const swayTarget = weather === "wind" ? 0.16 : weather === "rain" ? 0.1 : 0.06;
  useEffect(() => {
    if (swayEnabled) return;
    for (const mesh of [stemRef.current, headRef.current, spikeRef.current]) {
      const uniforms = swayUniforms(mesh);
      if (uniforms) uniforms.uSway.value = 0;
    }
  }, [swayEnabled]);

  useFrame((state, delta) => {
    if (!swayEnabled) return;
    swayLevel.current += (swayTarget - swayLevel.current) * Math.min(1, delta * 1.5);
    for (const mesh of [stemRef.current, headRef.current, spikeRef.current]) {
      const uniforms = swayUniforms(mesh);
      if (!uniforms) continue;
      uniforms.uTime.value = state.clock.elapsedTime;
      uniforms.uSway.value = swayLevel.current;
    }
  });

  const selectFlower = (owners: number[]) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const index = event.instanceId === undefined ? undefined : owners[event.instanceId];
    const flower = index === undefined ? undefined : flora.flowers[index];
    if (index === undefined || !flower) return;
    const ground = instances.flowerGround[index] ?? 0;
    onSelect?.({
      kind: "flower",
      id: `wildflower-${index}`,
      title: "Wildflowers",
      subtitle: "Pull requests and issues",
      description:
        "Every pull request and issue opened in the past year seeds more wildflowers across the meadow.",
      accent: palette.flowers[flower.variant],
      worldPosition: [flower.x, ground + flower.height + 0.4, flower.z],
      count: stats.pullRequests + stats.issues,
      details: [
        { label: "Pull requests (12 mo)", value: stats.pullRequests.toLocaleString() },
        { label: "Issues (12 mo)", value: stats.issues.toLocaleString() },
      ],
    });
  };

  const cursorHandlers = useMemo(
    () => ({
      onPointerOver: (event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        const target = event.nativeEvent.target;
        if (target instanceof HTMLElement) target.style.cursor = "pointer";
      },
      onPointerOut: (event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        const target = event.nativeEvent.target;
        if (target instanceof HTMLElement) target.style.cursor = "grab";
      },
    }),
    [],
  );

  const shadows = tier.shadows;
  const { stones, stems, heads, spikes, shrubs, rocks } = instances;

  return (
    <group name="flora">
      {stones.matrices.length > 0 ? (
        <instancedMesh
          key={`stones-${stones.matrices.length}`}
          ref={stoneRef}
          args={[stoneGeometry, stoneMaterial, stones.matrices.length]}
          receiveShadow={shadows}
        />
      ) : null}
      {stems.matrices.length > 0 ? (
        <instancedMesh
          key={`stems-${stems.matrices.length}`}
          ref={stemRef}
          args={[stemGeometry, stemMaterial, stems.matrices.length]}
          receiveShadow={shadows}
          onClick={selectFlower(stems.owners)}
          {...cursorHandlers}
        />
      ) : null}
      {heads.matrices.length > 0 ? (
        <instancedMesh
          key={`heads-${heads.matrices.length}`}
          ref={headRef}
          args={[headGeometry, headMaterial, heads.matrices.length]}
          receiveShadow={shadows}
          onClick={selectFlower(heads.owners)}
          {...cursorHandlers}
        />
      ) : null}
      {spikes.matrices.length > 0 ? (
        <instancedMesh
          key={`spikes-${spikes.matrices.length}`}
          ref={spikeRef}
          args={[spikeGeometry, spikeMaterial, spikes.matrices.length]}
          receiveShadow={shadows}
          onClick={selectFlower(spikes.owners)}
          {...cursorHandlers}
        />
      ) : null}
      {shrubs.matrices.length > 0 ? (
        <instancedMesh
          key={`shrubs-${shrubs.matrices.length}`}
          ref={shrubRef}
          args={[shrubGeometry, shrubMaterial, shrubs.matrices.length]}
          castShadow={shadows}
          receiveShadow={shadows}
        />
      ) : null}
      {rocks.matrices.length > 0 ? (
        <instancedMesh
          key={`rocks-${rocks.matrices.length}`}
          ref={rockRef}
          args={[rockGeometry, rockMaterial, rocks.matrices.length]}
          castShadow={shadows}
          receiveShadow={shadows}
        />
      ) : null}
    </group>
  );
}
