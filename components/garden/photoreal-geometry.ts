import * as THREE from "three";

import type { GardenQuality } from "./types";

export const PHOTOREAL_ISLAND_MATERIAL_INDEX = {
  cliff: 0,
  ground: 1,
  soil: 2,
} as const;

export interface PhotorealIslandGeometryOptions {
  /**
   * The island's maximum horizontal radius. Values are constrained to an
   * 11–13 metre range so the finished island remains 22–26 metres wide.
   */
  radius: number;
  quality: GardenQuality;
  seed: number;
}

export interface PhotorealIslandSurfaceSampleOptions
  extends PhotorealIslandGeometryOptions {
  x: number;
  z: number;
}

export type PhotorealIslandSurfaceSampler = (
  x: number,
  z: number,
) => number | null;

interface GeometryResolution {
  angularSegments: number;
  radialSegments: number;
  cliffDepthSteps: readonly number[];
}

interface Harmonic {
  amplitude: number;
  frequency: number;
  phase: number;
}

interface IslandProfile {
  cliffDepth: number;
  maximumRadius: number;
  rimRadiusAt: (angle: number) => number;
  rockPhase: number;
  soilPhase: number;
  spineAngle: number;
  stableSeed: number;
  surfaceContains: (x: number, z: number) => boolean;
  terrainHeightAt: (x: number, z: number) => number;
}

const TAU = Math.PI * 2;
const POND_X = -2.35;
const POND_Z = 1.25;

const QUALITY_RESOLUTION: Record<GardenQuality, GeometryResolution> = {
  low: {
    angularSegments: 64,
    radialSegments: 16,
    cliffDepthSteps: [0, 0.065, 0.15, 0.3, 0.5, 0.7, 0.86, 1],
  },
  medium: {
    angularSegments: 112,
    radialSegments: 28,
    cliffDepthSteps: [0, 0.065, 0.15, 0.23, 0.32, 0.43, 0.55, 0.67, 0.78, 0.88, 0.95, 1],
  },
  high: {
    angularSegments: 160,
    radialSegments: 42,
    cliffDepthSteps: [
      0,
      0.04,
      0.08,
      0.14,
      0.21,
      0.29,
      0.38,
      0.48,
      0.58,
      0.68,
      0.77,
      0.85,
      0.91,
      0.96,
      1,
    ],
  },
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  // Guard equal edges so a misconfigured ramp cannot poison geometry with NaN.
  if (edge1 === edge0) return value < edge0 ? 0 : 1;
  const progress = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function smootherstep(value: number) {
  const progress = clamp(value, 0, 1);
  return progress * progress * progress * (progress * (progress * 6 - 15) + 10);
}

function mix(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function normalizeSeed(seed: number) {
  if (!Number.isFinite(seed)) return 0;
  return Math.trunc(seed) | 0;
}

function createSeededRandom(seed: number) {
  let state = normalizeSeed(seed) >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashGrid(x: number, z: number, seed: number) {
  let value =
    Math.imul(x, 0x1f123bb5) ^
    Math.imul(z, 0x5f356495) ^
    Math.imul(seed, 0x6c8e9cf5);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967295;
}

function valueNoise2D(x: number, z: number, seed: number) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const tx = smootherstep(x - x0);
  const tz = smootherstep(z - z0);

  const lower = mix(hashGrid(x0, z0, seed), hashGrid(x1, z0, seed), tx);
  const upper = mix(hashGrid(x0, z1, seed), hashGrid(x1, z1, seed), tx);
  return mix(lower, upper, tz) * 2 - 1;
}

function fbm2D(
  x: number,
  z: number,
  seed: number,
  octaves: number,
) {
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  let normalization = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2D(x * frequency, z * frequency, seed + octave * 1013) * amplitude;
    normalization += amplitude;
    frequency *= 2.03;
    amplitude *= 0.5;
  }

  return total / normalization;
}

function sampleCliffProfile(depth: number) {
  const profile: ReadonlyArray<readonly [number, number]> = [
    [0, 1.004],
    [0.065, 1.032],
    [0.15, 0.965],
    [0.3, 0.84],
    [0.5, 0.68],
    [0.7, 0.49],
    [0.86, 0.31],
    [1, 0.095],
  ];

  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1];
    const next = profile[index];
    if (depth <= next[0]) {
      const amount = smoothstep(previous[0], next[0], depth);
      return mix(previous[1], next[1], amount);
    }
  }

  return profile[profile.length - 1][1];
}

function createIslandProfile(radius: number, seed: number): IslandProfile {
  const maximumRadius = clamp(Number.isFinite(radius) ? radius : 12, 11, 13);
  const stableSeed = normalizeSeed(seed);
  const random = createSeededRandom(stableSeed);
  const cliffDepth = maximumRadius * (0.48 + random() * 0.035);

  const rimHarmonics: Harmonic[] = [2, 3, 5, 7, 11, 17].map(
    (frequency, index) => ({
      amplitude: [0.019, 0.014, 0.011, 0.008, 0.0055, 0.0035][index],
      frequency,
      phase: random() * TAU,
    }),
  );
  const rimErosionPhase = random() * TAU;
  const soilPhase = random() * TAU;
  const rockPhase = random() * TAU;
  const spineAngle = random() * TAU;

  const rimRadiusAt = (angle: number) => {
    let scale = 0.958;
    for (const harmonic of rimHarmonics) {
      scale += harmonic.amplitude * Math.sin(angle * harmonic.frequency + harmonic.phase);
    }

    const broadNotch =
      Math.pow(Math.max(0, Math.cos(angle - rimErosionPhase)), 8) * 0.035;
    return maximumRadius * clamp(scale - broadNotch, 0.9, 1);
  };

  const normalizedRadiusAt = (x: number, z: number) => {
    const distance = Math.hypot(x, z);
    if (distance < 1e-8) return 0;
    return distance / rimRadiusAt(Math.atan2(z, x));
  };

  const surfaceContains = (x: number, z: number) =>
    normalizedRadiusAt(x, z) <= 1 + 1e-7;

  const terrainHeightAt = (x: number, z: number) => {
    const normalizedRadius = normalizedRadiusAt(x, z);
    const broadNoise = fbm2D(x * 0.082, z * 0.082, stableSeed + 31, 5);
    const surfaceNoise = fbm2D(x * 0.31, z * 0.31, stableSeed + 79, 3);
    const crown = (1 - Math.pow(clamp(normalizedRadius, 0, 1), 1.65)) * 0.2;
    const rimFalloff =
      smoothstep(0.77, 1, normalizedRadius) *
      (0.22 + 0.08 * Math.sin(Math.atan2(z, x) * 9 + rimErosionPhase));

    const pondDistance =
      Math.pow((x - POND_X) / 2.18, 2) +
      Math.pow((z - POND_Z) / 1.42, 2);
    const pondDepression =
      pondDistance < 1
        ? Math.pow(1 - smoothstep(0.04, 1, pondDistance), 1.3) * 0.28
        : 0;

    const pathDistance = Math.abs(z + x * 0.24 + 2.3) / Math.sqrt(1 + 0.24 ** 2);
    const pathDepression =
      (1 - smoothstep(0.16, 0.72, pathDistance)) *
      (1 - smoothstep(0.82, 1, normalizedRadius)) *
      0.055;

    return (
      0.42 +
      broadNoise * 0.54 +
      surfaceNoise * 0.11 +
      crown -
      rimFalloff -
      pondDepression -
      pathDepression
    );
  };

  return {
    cliffDepth,
    maximumRadius,
    rimRadiusAt,
    rockPhase,
    soilPhase,
    spineAngle,
    stableSeed,
    surfaceContains,
    terrainHeightAt,
  };
}

/**
 * Creates a reusable continuous surface sampler. It returns `null` beyond the
 * irregular ground rim, where the floating island has no walkable top surface.
 */
export function createPhotorealIslandSurfaceSampler({
  radius,
  seed,
}: PhotorealIslandGeometryOptions): PhotorealIslandSurfaceSampler {
  const profile = createIslandProfile(radius, seed);

  return (x, z) =>
    profile.surfaceContains(x, z) ? profile.terrainHeightAt(x, z) : null;
}

/**
 * Samples the same deterministic height profile used to generate the island.
 * Prefer `createPhotorealIslandSurfaceSampler` for per-frame sampling.
 */
export function samplePhotorealIslandSurfaceHeight({
  x,
  z,
  radius,
  seed,
}: PhotorealIslandSurfaceSampleOptions): number | null {
  const profile = createIslandProfile(radius, seed);
  return profile.surfaceContains(x, z) ? profile.terrainHeightAt(x, z) : null;
}

/**
 * Builds a single indexed geometry with three material groups:
 * 0 = rocky cliff, 1 = living ground, 2 = exposed soil cap.
 */
export function createPhotorealIslandGeometry({
  radius,
  quality,
  seed,
}: PhotorealIslandGeometryOptions): THREE.BufferGeometry {
  const resolution = QUALITY_RESOLUTION[quality] ?? QUALITY_RESOLUTION.medium;
  const angularSegments = resolution.angularSegments;
  const radialSegments = resolution.radialSegments;
  const {
    cliffDepth,
    maximumRadius,
    rimRadiusAt,
    rockPhase,
    soilPhase,
    spineAngle,
    stableSeed,
    terrainHeightAt,
  } = createIslandProfile(radius, seed);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushVertex = (x: number, y: number, z: number, u: number, v: number) => {
    const index = positions.length / 3;
    positions.push(x, y, z);
    uvs.push(u, v);
    return index;
  };

  const groundIndexStart = indices.length;
  const topRingStarts: number[] = [];
  const centerIndex = pushVertex(
    0,
    terrainHeightAt(0, 0),
    0,
    0.5,
    0.5,
  );
  topRingStarts[0] = centerIndex;

  for (let ring = 1; ring <= radialSegments; ring += 1) {
    const normalizedRadius = ring / radialSegments;
    topRingStarts[ring] = positions.length / 3;

    for (let segment = 0; segment <= angularSegments; segment += 1) {
      const angle = (segment / angularSegments) * TAU;
      const localRadius = rimRadiusAt(angle) * normalizedRadius;
      const x = Math.cos(angle) * localRadius;
      const z = Math.sin(angle) * localRadius;
      const y = terrainHeightAt(x, z);
      pushVertex(
        x,
        y,
        z,
        0.5 + x / (maximumRadius * 2),
        0.5 + z / (maximumRadius * 2),
      );
    }
  }

  const firstRingStart = topRingStarts[1];
  for (let segment = 0; segment < angularSegments; segment += 1) {
    indices.push(centerIndex, firstRingStart + segment + 1, firstRingStart + segment);
  }

  for (let ring = 2; ring <= radialSegments; ring += 1) {
    const innerStart = topRingStarts[ring - 1];
    const outerStart = topRingStarts[ring];

    for (let segment = 0; segment < angularSegments; segment += 1) {
      const innerCurrent = innerStart + segment;
      const innerNext = innerCurrent + 1;
      const outerCurrent = outerStart + segment;
      const outerNext = outerCurrent + 1;
      indices.push(innerCurrent, innerNext, outerCurrent);
      indices.push(innerNext, outerNext, outerCurrent);
    }
  }
  const groundIndexCount = indices.length - groundIndexStart;

  const soilIndexStart = indices.length;
  const soilTopStart = positions.length / 3;
  const soilBottomStart = soilTopStart + angularSegments + 1;
  const soilBottomX: number[] = [];
  const soilBottomY: number[] = [];
  const soilBottomZ: number[] = [];

  for (let segment = 0; segment <= angularSegments; segment += 1) {
    const angle = (segment / angularSegments) * TAU;
    const rimRadius = rimRadiusAt(angle);
    const x = Math.cos(angle) * rimRadius;
    const z = Math.sin(angle) * rimRadius;
    const y = terrainHeightAt(x, z);
    pushVertex(x, y, z, (segment / angularSegments) * 4, 1);
  }

  for (let segment = 0; segment <= angularSegments; segment += 1) {
    const angle = (segment / angularSegments) * TAU;
    const rimRadius = rimRadiusAt(angle);
    const exposedSoilDepth = clamp(
      0.3 +
        Math.sin(angle * 5 + soilPhase) * 0.065 +
        Math.sin(angle * 13 - soilPhase * 0.7) * 0.028,
      0.2,
      0.43,
    );
    const lowerRadius =
      rimRadius *
      (1.003 + Math.sin(angle * 7 + soilPhase * 0.4) * 0.004);
    const x = Math.cos(angle) * lowerRadius;
    const z = Math.sin(angle) * lowerRadius;
    const y =
      terrainHeightAt(
        Math.cos(angle) * rimRadius,
        Math.sin(angle) * rimRadius,
      ) - exposedSoilDepth;

    soilBottomX.push(x);
    soilBottomY.push(y);
    soilBottomZ.push(z);
    pushVertex(x, y, z, (segment / angularSegments) * 4, 0);
  }

  for (let segment = 0; segment < angularSegments; segment += 1) {
    const topCurrent = soilTopStart + segment;
    const topNext = topCurrent + 1;
    const bottomCurrent = soilBottomStart + segment;
    const bottomNext = bottomCurrent + 1;
    indices.push(topCurrent, topNext, bottomCurrent);
    indices.push(topNext, bottomNext, bottomCurrent);
  }
  const soilIndexCount = indices.length - soilIndexStart;

  const cliffIndexStart = indices.length;
  const cliffRingStarts: number[] = [];
  const averageSoilBase =
    soilBottomY.slice(0, angularSegments).reduce((sum, value) => sum + value, 0) /
    angularSegments;
  const spineOffsetX = Math.cos(spineAngle) * maximumRadius * 0.04;
  const spineOffsetZ = Math.sin(spineAngle) * maximumRadius * 0.04;

  for (
    let ringIndex = 0;
    ringIndex < resolution.cliffDepthSteps.length;
    ringIndex += 1
  ) {
    const depth = resolution.cliffDepthSteps[ringIndex];
    const profileRadius = sampleCliffProfile(depth);
    cliffRingStarts[ringIndex] = positions.length / 3;

    for (let segment = 0; segment <= angularSegments; segment += 1) {
      const angle = (segment / angularSegments) * TAU;

      if (ringIndex === 0) {
        pushVertex(
          soilBottomX[segment],
          soilBottomY[segment],
          soilBottomZ[segment],
          (segment / angularSegments) * 5,
          0,
        );
        continue;
      }

      const circularX = Math.cos(angle) * 2.35 + depth * 2.8;
      const circularZ = Math.sin(angle) * 2.35 - depth * 1.9;
      const rockNoise = fbm2D(
        circularX,
        circularZ,
        stableSeed + 211 + ringIndex * 17,
        3,
      );
      const angularCrags =
        Math.sin(angle * 13 + rockPhase + depth * 4.1) * 0.55 +
        Math.sin(angle * 23 - rockPhase * 0.6 - depth * 6.3) * 0.3 +
        rockNoise * 0.65;
      const roughnessAmplitude = maximumRadius * (0.0045 + depth * 0.014);
      const localRadius = Math.max(
        maximumRadius * 0.045,
        rimRadiusAt(angle) * profileRadius + angularCrags * roughnessAmplitude,
      );
      const spineAmount = Math.pow(depth, 1.35);
      const x =
        Math.cos(angle) * localRadius +
        spineOffsetX * spineAmount;
      const z =
        Math.sin(angle) * localRadius +
        spineOffsetZ * spineAmount;
      const inheritedRimHeight = mix(
        soilBottomY[segment],
        averageSoilBase,
        smoothstep(0.12, 0.82, depth),
      );
      const verticalRockNoise =
        Math.sin(angle * 9 - rockPhase + depth * 7.7) * 0.09 +
        rockNoise * (0.08 + depth * 0.14);
      const y = inheritedRimHeight - cliffDepth * depth + verticalRockNoise;

      pushVertex(
        x,
        y,
        z,
        (segment / angularSegments) * 5,
        depth * 3.2,
      );
    }
  }

  for (
    let ringIndex = 0;
    ringIndex < cliffRingStarts.length - 1;
    ringIndex += 1
  ) {
    const upperStart = cliffRingStarts[ringIndex];
    const lowerStart = cliffRingStarts[ringIndex + 1];

    for (let segment = 0; segment < angularSegments; segment += 1) {
      const upperCurrent = upperStart + segment;
      const upperNext = upperCurrent + 1;
      const lowerCurrent = lowerStart + segment;
      const lowerNext = lowerCurrent + 1;
      indices.push(upperCurrent, upperNext, lowerCurrent);
      indices.push(upperNext, lowerNext, lowerCurrent);
    }
  }

  const lastCliffStart = cliffRingStarts[cliffRingStarts.length - 1];
  const undersideTip = pushVertex(
    spineOffsetX * 1.08,
    averageSoilBase - cliffDepth - maximumRadius * 0.075,
    spineOffsetZ * 1.08,
    2.5,
    3.48,
  );
  for (let segment = 0; segment < angularSegments; segment += 1) {
    indices.push(lastCliffStart + segment, lastCliffStart + segment + 1, undersideTip);
  }
  const cliffIndexCount = indices.length - cliffIndexStart;

  const geometry = new THREE.BufferGeometry();
  geometry.name = "PhotorealFloatingIslandGeometry";
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute(
    "uv2",
    new THREE.Float32BufferAttribute(uvs.slice(), 2),
  );
  geometry.setIndex(indices);
  geometry.clearGroups();
  geometry.addGroup(
    groundIndexStart,
    groundIndexCount,
    PHOTOREAL_ISLAND_MATERIAL_INDEX.ground,
  );
  geometry.addGroup(
    soilIndexStart,
    soilIndexCount,
    PHOTOREAL_ISLAND_MATERIAL_INDEX.soil,
  );
  geometry.addGroup(
    cliffIndexStart,
    cliffIndexCount,
    PHOTOREAL_ISLAND_MATERIAL_INDEX.cliff,
  );
  geometry.computeVertexNormals();
  const positionAttribute = geometry.getAttribute(
    "position",
  ) as THREE.BufferAttribute;
  const normalAttribute = geometry.getAttribute(
    "normal",
  ) as THREE.BufferAttribute;
  const colorValues = new Float32Array(positionAttribute.count * 3);
  for (let index = 0; index < positionAttribute.count; index += 1) {
    const x = positionAttribute.getX(index);
    const y = positionAttribute.getY(index);
    const z = positionAttribute.getZ(index);
    const normalY = normalAttribute.getY(index);
    const broadVariation =
      fbm2D(x * 0.19, z * 0.19, stableSeed + 503, 3) * 0.055;
    const cliffStrata =
      normalY < 0.58
        ? Math.sin(y * 7.2 + x * 0.16 - z * 0.11) * 0.035
        : 0;
    const shade = clamp(
      0.9 + broadVariation + cliffStrata + Math.max(0, normalY) * 0.075,
      0.76,
      1.04,
    );
    colorValues[index * 3] = shade;
    colorValues[index * 3 + 1] = shade;
    colorValues[index * 3 + 2] = shade;
  }
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colorValues, 3),
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  Object.assign(geometry.userData, {
    materialOrder: ["cliff", "ground", "soil"],
    maximumRadius,
    approximateDepth: cliffDepth + maximumRadius * 0.075,
    seed: stableSeed,
  });

  return geometry;
}
