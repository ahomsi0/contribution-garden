"use client";

import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  useTexture,
} from "@react-three/drei";
import * as THREE from "three";

import type {
  GardenDay,
  GardenQuality,
  GardenSceneProps,
  GardenSeason,
  GardenSelection,
  GardenStats,
  GardenTimeOfDay,
  GardenWalkInput,
  GardenWeather,
} from "./types";
import { LightweightNature } from "./LightweightNature";
import {
  createPhotorealIslandGeometry,
  createPhotorealIslandSurfaceSampler,
  type PhotorealIslandSurfaceSampler,
} from "./photoreal-geometry";
import {
  createVoxelSurfaceSampler,
  VoxelTerrain,
} from "./VoxelTerrain";

type VectorTuple = [number, number, number];

interface GardenPalette {
  sky: string;
  fog: string;
  horizon: string;
  ground: string;
  groundDry: string;
  earth: string;
  cliff: string;
  foliage: [string, string, string, string];
  flowers: [string, string, string, string];
  trunk: string;
  stone: string;
  stoneLight: string;
  water: string;
  waterGlow: string;
  sun: string;
  ambient: string;
  lightIntensity: number;
  ambientIntensity: number;
  mote: string;
}

interface ScatterItem {
  x: number;
  z: number;
  rotation: number;
  scale: number;
  variant: number;
}

interface TreeItem extends ScatterItem {
  age: number;
}

interface EdgeScatterItem extends ScatterItem {
  radius: number;
}

interface ContributionPlantItem extends ScatterItem {
  dayIndex: number;
  level: number;
}

const WORLD_RADIUS = 11.5;
const ISLAND_SURFACE_OFFSET = -0.7;
const POND_X = -2.35;
const POND_Z = 1.25;
const CONTRIBUTION_BED_START = -Math.PI * 0.9;
const CONTRIBUTION_BED_LENGTH = Math.PI * 1.5;
const EMPTY_WALK_INPUT: GardenWalkInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
};

const SEASON_PALETTES: Record<
  GardenSeason,
  Pick<
    GardenPalette,
    | "ground"
    | "groundDry"
    | "earth"
    | "cliff"
    | "foliage"
    | "flowers"
    | "trunk"
    | "stone"
    | "stoneLight"
    | "water"
    | "waterGlow"
    | "mote"
  >
> = {
  spring: {
    ground: "#70865b",
    groundDry: "#948163",
    earth: "#514237",
    cliff: "#6f665d",
    foliage: ["#294232", "#3c5838", "#526b43", "#71815a"],
    flowers: ["#c89ca8", "#d7c58b", "#9e98b8", "#e3ddd0"],
    trunk: "#584538",
    stone: "#70756e",
    stoneLight: "#a9aca0",
    water: "#4e7374",
    waterGlow: "#89aaa5",
    mote: "#d9cfaa",
  },
  summer: {
    ground: "#71865e",
    groundDry: "#948462",
    earth: "#49392f",
    cliff: "#685d53",
    foliage: ["#233d2e", "#34523a", "#496741", "#657d50"],
    flowers: ["#cea767", "#bd7776", "#d2cfac", "#7fa2aa"],
    trunk: "#504034",
    stone: "#686f6a",
    stoneLight: "#9fa699",
    water: "#456c70",
    waterGlow: "#7da49e",
    mote: "#d8c57c",
  },
  autumn: {
    ground: "#6b7350",
    groundDry: "#8e704d",
    earth: "#49372d",
    cliff: "#65554a",
    foliage: ["#6b4032", "#87513a", "#a56c42", "#b58a53"],
    flowers: ["#b99759", "#a96848", "#d7caa6", "#815b65"],
    trunk: "#4d3a31",
    stone: "#686960",
    stoneLight: "#9e998a",
    water: "#526e6c",
    waterGlow: "#829c92",
    mote: "#c59e62",
  },
  winter: {
    ground: "#c4cdc8",
    groundDry: "#9e9d8d",
    earth: "#49423d",
    cliff: "#69645f",
    foliage: ["#2f443d", "#40564c", "#5d6c62", "#7c8980"],
    flowers: ["#b9c6c8", "#d7dcda", "#9facb5", "#c2b8c6"],
    trunk: "#4c413a",
    stone: "#6b7271",
    stoneLight: "#bbc2bf",
    water: "#6f8b92",
    waterGlow: "#b0c5c6",
    mote: "#dce4e6",
  },
};

const DAY_PALETTES: Record<
  GardenTimeOfDay,
  Pick<
    GardenPalette,
    | "sky"
    | "fog"
    | "horizon"
    | "sun"
    | "ambient"
    | "lightIntensity"
    | "ambientIntensity"
  >
> = {
  morning: {
    sky: "#9eb7b2",
    fog: "#c4ccc4",
    horizon: "#d5b58a",
    sun: "#f5d2a2",
    ambient: "#c5cec7",
    lightIntensity: 2.8,
    ambientIntensity: 0.4,
  },
  day: {
    sky: "#8daeb6",
    fog: "#bdc9c4",
    horizon: "#cbd2bd",
    sun: "#f6e5bb",
    ambient: "#cbd5cd",
    lightIntensity: 3.2,
    ambientIntensity: 0.46,
  },
  sunset: {
    sky: "#857c87",
    fog: "#aa9489",
    horizon: "#c59269",
    sun: "#efae72",
    ambient: "#b9a19a",
    lightIntensity: 2.6,
    ambientIntensity: 0.34,
  },
  night: {
    sky: "#111925",
    fog: "#293440",
    horizon: "#354352",
    sun: "#bdc9dc",
    ambient: "#708097",
    lightIntensity: 0.78,
    ambientIntensity: 0.18,
  },
};

const QUALITY_MULTIPLIER: Record<GardenQuality, number> = {
  low: 0.55,
  medium: 0.46,
  high: 1,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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

function isOutsidePond(x: number, z: number, padding = 1) {
  const pondDistance =
    ((x - POND_X) * (x - POND_X)) / (2.25 * 2.25 * padding) +
    ((z - POND_Z) * (z - POND_Z)) / (1.45 * 1.45 * padding);
  return pondDistance > 1;
}

function createScatter(
  count: number,
  seed: number,
  radius = 7.15,
  pondPadding = 1,
): ScatterItem[] {
  const random = seededRandom(seed);
  const items: ScatterItem[] = [];
  let attempts = 0;

  while (items.length < count && attempts < count * 18) {
    attempts += 1;
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;

    if (!isOutsidePond(x, z, pondPadding)) continue;
    if (Math.abs(z + x * 0.24 + 2.3) < 0.32 && random() > 0.18) continue;

    items.push({
      x,
      z,
      rotation: random() * Math.PI * 2,
      scale: 0.72 + random() * 0.72,
      variant: Math.floor(random() * 4),
    });
  }

  return items;
}

function createContributionPlantings(
  days: GardenDay[],
  density: number,
  seed: number,
  visibleThrough?: string,
): ContributionPlantItem[] {
  if (days.length === 0) return [];

  const years = Array.from(
    new Set(days.map((day) => Number(day.date.slice(0, 4)))),
  ).sort((a, b) => a - b);
  const yearSlots = new Map(years.map((year, index) => [year, index]));
  const ringSpacing =
    years.length <= 1 ? 0 : Math.min(0.62, 3.55 / (years.length - 1));
  const items: ContributionPlantItem[] = [];

  days.forEach((day, dayIndex) => {
    if (visibleThrough && day.date > visibleThrough) return;

    const year = Number(day.date.slice(0, 4));
    const yearSlot = yearSlots.get(year) ?? 0;
    const startOfYear = Date.UTC(year, 0, 1);
    const currentDay = Date.parse(`${day.date}T00:00:00Z`);
    const dayOfYear = Math.max(
      0,
      Math.round((currentDay - startOfYear) / 86_400_000),
    );
    const daysInYear =
      Date.UTC(year + 1, 0, 1) - startOfYear === 366 * 86_400_000 ? 366 : 365;
    const progress = dayOfYear / Math.max(1, daysInYear - 1);
    const angle =
      CONTRIBUTION_BED_START +
      progress * CONTRIBUTION_BED_LENGTH +
      yearSlot * 0.012;
    const radius = 3.12 + yearSlot * ringSpacing;
    const level = clamp(Math.round(day.level), 0, 4);
    const random = seededRandom(hashString(`${seed}:${day.date}`));
    const bladeCount =
      level === 0
        ? 0
        : Math.max(1, Math.round((0.7 + level * 0.65) * density));

    for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex += 1) {
      const tangential =
        (random() - 0.5) * (0.18 + level * 0.045);
      const radial =
        (random() - 0.5) * (0.16 + level * 0.04);
      let localRadius = radius + radial;
      let x =
        Math.cos(angle) * localRadius - Math.sin(angle) * tangential;
      let z =
        Math.sin(angle) * localRadius + Math.cos(angle) * tangential;
      const pathDelta = z + x * 0.24 + 2.3;
      if (Math.abs(pathDelta) < 0.42) {
        z +=
          (0.42 - Math.abs(pathDelta)) * (pathDelta >= 0 ? 1 : -1);
      }
      if (!isOutsidePond(x, z, 1.55)) {
        localRadius += 0.72;
        x = Math.cos(angle) * localRadius - Math.sin(angle) * tangential;
        z = Math.sin(angle) * localRadius + Math.cos(angle) * tangential;
      }

      items.push({
        x,
        z,
        rotation: random() * Math.PI * 2,
        scale:
          level === 0
            ? 0.3 + random() * 0.14
            : 0.5 + level * 0.12 + random() * 0.22,
        variant: Math.max(0, level - 1),
        dayIndex,
        level,
      });
    }
  });

  return items;
}

function createFlowerClusters(count: number, seed: number): ScatterItem[] {
  const random = seededRandom(seed);
  const centers: Array<[number, number]> = [
    [POND_X - 2.02, POND_Z + 0.16],
    [POND_X - 0.18, POND_Z + 1.78],
    [POND_X + 2.14, POND_Z + 0.48],
    [3.35, -3.12],
    [0.72, -2.42],
  ];
  const items: ScatterItem[] = [];
  let attempts = 0;

  while (items.length < count && attempts < count * 24) {
    const center = centers[attempts % centers.length];
    attempts += 1;
    const angle = random() * Math.PI * 2;
    const distance = 0.16 + Math.sqrt(random()) * 0.72;
    const x = center[0] + Math.cos(angle) * distance;
    const z = center[1] + Math.sin(angle) * distance * 0.68;

    if (Math.hypot(x, z) > 7.05 || !isOutsidePond(x, z, 1.08)) continue;

    items.push({
      x,
      z,
      rotation: random() * Math.PI * 2,
      scale: 0.72 + random() * 0.68,
      variant: Math.floor(random() * 4),
    });
  }

  return items;
}

function createTrees(count: number, seed: number): TreeItem[] {
  const random = seededRandom(seed);
  const items: TreeItem[] = [];
  const groveArcs = [
    { start: Math.PI * 0.62, length: Math.PI * 0.48 },
    { start: Math.PI * 1.05, length: Math.PI * 0.34 },
    { start: -Math.PI * 0.08, length: Math.PI * 0.3 },
  ];
  let attempts = 0;

  while (items.length < count && attempts < count * 30) {
    attempts += 1;
    const arc = groveArcs[Math.floor(random() * groveArcs.length)];
    const angle = arc.start + random() * arc.length;
    const distance = 4.05 + random() * 2.85;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;

    if (!isOutsidePond(x, z, 1.7)) continue;
    if (x > 0.7 && x < 4.2 && z > -1.6 && z < 2.2) continue;
    if (Math.abs(z + x * 0.24 + 2.3) < 0.72) continue;
    if (items.some((item) => Math.hypot(item.x - x, item.z - z) < 1.28)) continue;

    items.push({
      x,
      z,
      rotation: random() * Math.PI * 2,
      scale: 0.68 + random() * 0.43,
      age: random(),
      variant: Math.floor(random() * 4),
    });
  }

  return items;
}

function createEdgeScatter(
  count: number,
  seed: number,
  minRadius = 5.2,
  maxRadius = 7.25,
): EdgeScatterItem[] {
  const random = seededRandom(seed);
  const items: EdgeScatterItem[] = [];
  let attempts = 0;

  while (items.length < count && attempts < count * 22) {
    attempts += 1;
    const angle = random() * Math.PI * 2;
    const radius = minRadius + random() * (maxRadius - minRadius);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    if (!isOutsidePond(x, z, 1.42)) continue;
    if (Math.abs(z + x * 0.24 + 2.3) < 0.48 && random() > 0.14) continue;

    items.push({
      x,
      z,
      radius,
      rotation: random() * Math.PI * 2,
      scale: 0.62 + random() * 0.82,
      variant: Math.floor(random() * 4),
    });
  }

  return items;
}

function createIslandGeometry(quality: GardenQuality, seed: number) {
  return createPhotorealIslandGeometry({
    radius: WORLD_RADIUS,
    quality,
    seed,
  });
}

function createOrganicPondGeometry(
  seed: number,
  segments: number,
  radius = 1,
) {
  const geometry = new THREE.CircleGeometry(radius, segments);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uvs = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const random = seededRandom(seed);
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const phaseC = random() * Math.PI * 2;

  for (let index = 1; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const angle = Math.atan2(y, x);
    const edgeVariation =
      Math.sin(angle * 3 + phaseA) * 0.035 +
      Math.sin(angle * 5 + phaseB) * 0.022 +
      Math.sin(angle * 9 + phaseC) * 0.012;
    const edgeRadius = radius * (1 + edgeVariation);
    positions.setXY(index, Math.cos(angle) * edgeRadius, Math.sin(angle) * edgeRadius);
    uvs.setXY(
      index,
      0.5 + (Math.cos(angle) * edgeRadius) / (radius * 2.16),
      0.5 + (Math.sin(angle) * edgeRadius) / (radius * 2.16),
    );
  }

  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createWaterNormalTexture(seed: number, resolution = 128) {
  const data = new Uint8Array(resolution * resolution * 4);
  const random = seededRandom(seed);
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const phaseC = random() * Math.PI * 2;
  const normal = new THREE.Vector3();

  for (let y = 0; y < resolution; y += 1) {
    const v = y / resolution;
    for (let x = 0; x < resolution; x += 1) {
      const u = x / resolution;
      const waveA = Math.PI * 2 * (u * 3 + v * 2) + phaseA;
      const waveB = Math.PI * 2 * (u * -2 + v * 5) + phaseB;
      const waveC = Math.PI * 2 * (u * 7 - v * 3) + phaseC;
      const slopeX =
        Math.cos(waveA) * 0.54 +
        Math.cos(waveB) * -0.24 +
        Math.cos(waveC) * 0.13;
      const slopeY =
        Math.cos(waveA) * 0.36 +
        Math.cos(waveB) * 0.6 +
        Math.cos(waveC) * -0.055;
      normal.set(-slopeX * 0.16, -slopeY * 0.16, 1).normalize();

      const offset = (y * resolution + x) * 4;
      data[offset] = Math.round((normal.x * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(
    data,
    resolution,
    resolution,
    THREE.RGBAFormat,
  );
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.35, 1.7);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createGrassBladeGeometry(quality: GardenQuality) {
  if (quality === "medium") {
    const block = new THREE.BoxGeometry(0.18, 1, 0.18);
    block.translate(0, 0.5, 0);
    block.computeBoundingBox();
    block.computeBoundingSphere();
    return block;
  }

  const segments = quality === "low" ? 2 : 3;
  const positions: number[] = [];
  const uvs: number[] = [];

  const pushVertex = (x: number, y: number, z: number, u: number, v: number) => {
    positions.push(x, y, z);
    uvs.push(u, v);
  };

  for (const rotation of [0, Math.PI / 2, Math.PI / 4]) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const points: Array<{ left: VectorTuple; right: VectorTuple; v: number }> = [];

    for (let index = 0; index <= segments; index += 1) {
      const progress = index / segments;
      const width = 0.115 * Math.pow(1 - progress, 1.35) + 0.006;
      const bend = Math.sin(progress * Math.PI * 0.55) * 0.11;
      const centerX = cos * bend;
      const centerZ = sin * bend;
      const sideX = -sin * width;
      const sideZ = cos * width;
      points.push({
        left: [centerX + sideX, progress, centerZ + sideZ],
        right: [centerX - sideX, progress, centerZ - sideZ],
        v: progress,
      });
    }

    for (let index = 0; index < segments; index += 1) {
      const lower = points[index];
      const upper = points[index + 1];
      pushVertex(...lower.left, 0, lower.v);
      pushVertex(...lower.right, 1, lower.v);
      pushVertex(...upper.left, 0, upper.v);
      pushVertex(...lower.right, 1, lower.v);
      pushVertex(...upper.right, 1, upper.v);
      pushVertex(...upper.left, 0, upper.v);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createFlowerHeadGeometry() {
  const positions: number[] = [];
  const petalCount = 5;

  const pushTriangle = (a: VectorTuple, b: VectorTuple, c: VectorTuple) => {
    positions.push(...a, ...b, ...c);
  };

  for (let index = 0; index < petalCount; index += 1) {
    const angle = (index / petalCount) * Math.PI * 2;
    const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const base = direction.clone().multiplyScalar(0.05);
    const middle = direction.clone().multiplyScalar(0.54);
    const tip = direction.clone().multiplyScalar(0.98);
    middle.y = 0.12;
    tip.y = 0.05;
    const left = middle.clone().addScaledVector(side, 0.3);
    const right = middle.clone().addScaledVector(side, -0.3);

    pushTriangle(tupleFromVector(base), tupleFromVector(left), tupleFromVector(middle));
    pushTriangle(tupleFromVector(base), tupleFromVector(middle), tupleFromVector(right));
    pushTriangle(tupleFromVector(left), tupleFromVector(tip), tupleFromVector(middle));
    pushTriangle(tupleFromVector(middle), tupleFromVector(tip), tupleFromVector(right));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function paletteFor(season: GardenSeason, timeOfDay: GardenTimeOfDay) {
  return { ...SEASON_PALETTES[season], ...DAY_PALETTES[timeOfDay] };
}

function deriveActivity(stats: GardenStats, days: GardenDay[]) {
  if (days.length > 0) {
    const recent = days.slice(-56);
    const occupied = recent.filter((day) => day.count > 0).length / recent.length;
    const intensity =
      recent.reduce((total, day) => total + clamp(day.level, 0, 4), 0) /
      (recent.length * 4);
    return clamp01(occupied * 0.62 + intensity * 0.38);
  }

  return clamp01(0.25 + Math.log10(stats.totalContributions + 1) / 4.2);
}

function getFogRange(weather: GardenWeather, timeOfDay: GardenTimeOfDay) {
  if (weather === "fog") return { near: 7, far: 23 };
  if (weather === "rain" || weather === "snow") return { near: 13, far: 35 };
  if (timeOfDay === "night") return { near: 18, far: 41 };
  return { near: 23, far: 50 };
}

function mergeClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

function useSurfaceTextureSet(
  surface: "forest-floor" | "bark",
  repeatX: number,
  repeatY: number,
) {
  const texturePath = (channel: "color" | "normal" | "roughness") =>
    surface === "forest-floor"
      ? `/textures/${surface}-${channel}-512.webp`
      : `/textures/${surface}-${channel}.jpg`;
  const [colorSource, normalSource, roughnessSource] = useTexture([
    texturePath("color"),
    texturePath("normal"),
    texturePath("roughness"),
  ]);
  const textures = useMemo(() => {
    const clones = [
      colorSource.clone(),
      normalSource.clone(),
      roughnessSource.clone(),
    ] as [THREE.Texture, THREE.Texture, THREE.Texture];

    clones.forEach((texture, index) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeatX, repeatY);
      texture.anisotropy = 4;
      texture.colorSpace =
        index === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;
    });
    return clones;
  }, [
    colorSource,
    normalSource,
    repeatX,
    repeatY,
    roughnessSource,
  ]);

  useEffect(
    () => () => textures.forEach((texture) => texture.dispose()),
    [textures],
  );
  return textures;
}

export function GardenScene({
  stats,
  days = [],
  username = "gardener",
  season,
  weather,
  timeOfDay,
  visibleThrough,
  activity,
  flythrough = false,
  walkthrough = false,
  walkInput = EMPTY_WALK_INPUT,
  quality = "high",
  reducedMotion = false,
  className,
  onReady,
  onSelect,
  onFlythroughComplete,
  onWalkthroughExit,
}: GardenSceneProps) {
  const health = clamp01(activity ?? deriveActivity(stats, days));
  const seed = hashString(`${username}:contribution-garden-layout`);
  const palette = useMemo(
    () => paletteFor(season, timeOfDay),
    [season, timeOfDay],
  );
  const dpr: [number, number] =
    quality === "high"
      ? [1, 1.35]
      : quality === "medium"
        ? [1, 1.15]
        : [1, 1];

  return (
    <div
      className={mergeClassNames("contribution-garden", className)}
      data-contribution-garden="true"
      data-walkthrough={walkthrough ? "true" : "false"}
      role="region"
      aria-label={
        walkthrough
          ? "Interactive 3D garden walkthrough"
          : "Interactive 3D contribution garden"
      }
      style={{
        width: "100%",
        height: "100%",
        minHeight: 320,
        position: "relative",
        overflow: "hidden",
        background: palette.sky,
      }}
    >
      <Canvas
        className="contribution-garden-canvas"
        data-garden-canvas="true"
        camera={{
          position: [15.4, 10.8, 18.8],
          fov: 42,
          near: 0.1,
          far: 90,
        }}
        dpr={dpr}
        frameloop="always"
        gl={{
          antialias: quality !== "low",
          alpha: false,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = timeOfDay === "night" ? 1.04 : 1.08;
        }}
        onPointerMissed={() => onSelect?.(null)}
        shadows={quality !== "low" ? "percentage" : false}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
      >
        <Suspense fallback={null}>
          <GardenReadySignal onReady={onReady} />
          <GardenCaptureBridge />
          <GardenWorld
            stats={stats}
            days={days}
            season={season}
            weather={weather}
            timeOfDay={timeOfDay}
            visibleThrough={visibleThrough}
            quality={quality}
            reducedMotion={reducedMotion}
            health={health}
            seed={seed}
            palette={palette}
            flythrough={flythrough}
            walkthrough={walkthrough}
            walkInput={walkInput}
            onSelect={onSelect}
            onFlythroughComplete={onFlythroughComplete}
            onWalkthroughExit={onWalkthroughExit}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

function GardenReadySignal({ onReady }: { onReady?: () => void }) {
  const hasReported = useRef(false);

  useFrame(() => {
    if (hasReported.current) return;
    hasReported.current = true;
    onReady?.();
  });

  return null;
}

function GardenCaptureBridge() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const capture = (nativeEvent: Event) => {
      const event = nativeEvent as CustomEvent<{
        complete?: (blob: Blob | null) => void;
      }>;
      if (!event.detail?.complete) return;
      event.preventDefault();
      gl.render(scene, camera);
      gl.domElement.toBlob(event.detail.complete, "image/png");
    };

    window.addEventListener("contribution-garden:capture", capture);
    return () => {
      window.removeEventListener("contribution-garden:capture", capture);
    };
  }, [camera, gl, scene]);

  return null;
}

interface GardenWorldProps {
  stats: GardenStats;
  days: GardenDay[];
  season: GardenSeason;
  weather: GardenWeather;
  timeOfDay: GardenTimeOfDay;
  visibleThrough?: string;
  quality: GardenQuality;
  reducedMotion: boolean;
  health: number;
  seed: number;
  palette: GardenPalette;
  flythrough: boolean;
  walkthrough: boolean;
  walkInput: GardenWalkInput;
  onSelect?: (selection: GardenSelection | null) => void;
  onFlythroughComplete?: () => void;
  onWalkthroughExit?: () => void;
}

function GardenWorld({
  stats,
  days,
  season,
  weather,
  timeOfDay,
  visibleThrough,
  quality,
  reducedMotion,
  health,
  seed,
  palette,
  flythrough,
  walkthrough,
  walkInput,
  onSelect,
  onFlythroughComplete,
  onWalkthroughExit,
}: GardenWorldProps) {
  const fog = getFogRange(weather, timeOfDay);
  const density = QUALITY_MULTIPLIER[quality];
  const sunPosition: VectorTuple =
    timeOfDay === "sunset"
      ? [-13, 7.5, -7]
      : timeOfDay === "morning"
        ? [-9, 11, 10]
        : timeOfDay === "night"
          ? [-11, 14, -13]
          : [11, 16, 9];
  const baseSurfaceSampler = useMemo(
    () =>
      createPhotorealIslandSurfaceSampler({
        radius: WORLD_RADIUS,
        quality,
        seed,
      }),
    [quality, seed],
  );
  const surfaceSampler = useMemo(
    () =>
      quality === "medium"
        ? createVoxelSurfaceSampler(baseSurfaceSampler)
        : baseSurfaceSampler,
    [baseSurfaceSampler, quality],
  );
  const heroRootY =
    (surfaceSampler(2.62, 0.48) ?? 0) + ISLAND_SURFACE_OFFSET;
  const selectPhotorealHeroTree = () => {
    const legendary = stats.streak >= 365;
    const ancient = stats.streak >= 1000;
    onSelect?.({
      kind: legendary ? "achievement" : "tree",
      id: "streak-tree",
      title: ancient
        ? "Ancient Spirit Tree"
        : legendary
          ? "Legendary streak tree"
          : "Streak tree",
      subtitle: "Streak landmark",
      description: legendary
        ? "Extraordinary consistency made this the oldest landmark in the garden."
        : "Each uninterrupted contribution day strengthens the oldest tree.",
      accent: legendary ? palette.waterGlow : palette.foliage[2],
      worldPosition: [2.62, heroRootY + 3.4, 0.48],
      details: [
        { label: "Longest streak", value: `${stats.streak} days` },
        {
          label: "State",
          value: ancient ? "Ancient" : legendary ? "Legendary" : "Growing",
        },
        {
          label: "Total contributions",
          value: stats.totalContributions.toLocaleString(),
        },
      ],
      count: stats.streak,
    });
  };

  return (
    <>
      <color attach="background" args={[palette.sky]} />
      <fog attach="fog" args={[palette.fog, fog.near, fog.far]} />

      <hemisphereLight
        args={[
          palette.ambient,
          timeOfDay === "night" ? "#273348" : palette.earth,
          palette.ambientIntensity * 1.9,
        ]}
      />
      <ambientLight
        color={timeOfDay === "night" ? "#708097" : "#fff2dc"}
        intensity={timeOfDay === "night" ? 0.08 : 0.22}
      />
      <directionalLight
        castShadow={quality !== "low"}
        color={palette.sun}
        intensity={palette.lightIntensity * 0.72}
        position={sunPosition}
        shadow-mapSize-height={quality === "high" ? 1024 : 768}
        shadow-mapSize-width={quality === "high" ? 1024 : 768}
        shadow-camera-bottom={-12.5}
        shadow-camera-far={48}
        shadow-camera-left={-12.5}
        shadow-camera-right={12.5}
        shadow-camera-top={12.5}
        shadow-bias={-0.00018}
        shadow-normalBias={0.018}
        shadow-radius={quality === "high" ? 3 : 1}
      />
      <directionalLight
        color={palette.horizon}
        intensity={timeOfDay === "night" ? 0.08 : 0.42}
        position={[-7, 8, 12]}
      />

      <AtmosphereDome
        palette={palette}
        quality={quality}
        timeOfDay={timeOfDay}
      />
      {timeOfDay === "night" ? (
        <CelestialBody
          blocky={quality === "medium"}
          timeOfDay={timeOfDay}
          palette={palette}
        />
      ) : null}
      {quality === "low" ? (
        <CloudLayer
          density={density}
          palette={palette}
          quality={quality}
          reducedMotion={reducedMotion}
          seed={seed + 3}
          timeOfDay={timeOfDay}
          weather={weather}
        />
      ) : null}
      <IslandTerrain
        health={health}
        palette={palette}
        quality={quality}
        reducedMotion={reducedMotion}
        season={season}
        seed={seed}
        stats={stats}
        surfaceSampler={surfaceSampler}
        timeOfDay={timeOfDay}
        weather={weather}
        onSelect={onSelect}
      />
      {quality !== "medium" ? (
        <StonePath
          palette={palette}
          quality={quality}
          seed={seed + 7}
          surfaceSampler={surfaceSampler}
        />
      ) : null}
      {quality === "low" ? (
        <>
          <RimRocks palette={palette} quality={quality} seed={seed + 13} />
          <GroundDetails
            health={health}
            palette={palette}
            quality={quality}
            season={season}
            seed={seed + 29}
          />
          <EdgeUnderstory
            health={health}
            palette={palette}
            quality={quality}
            season={season}
            seed={seed + 53}
          />
        </>
      ) : (
        <LightweightNature
          health={health}
          quality={quality}
          season={season}
          seed={seed + 53}
          surfaceOffset={ISLAND_SURFACE_OFFSET}
          surfaceSampler={surfaceSampler}
          heroScale={
            1.04 + health * 0.05 + Math.min(0.14, stats.streak / 5000)
          }
          onHeroSelect={selectPhotorealHeroTree}
        />
      )}

      {quality === "low" ? (
        <ContributionBedRibbons
          days={days}
          health={health}
          palette={palette}
          visibleThrough={visibleThrough}
        />
      ) : null}
      <GrassMeadow
        days={days}
        density={density}
        health={health}
        palette={palette}
        quality={quality}
        reducedMotion={reducedMotion}
        seed={seed + 101}
        stats={stats}
        surfaceSampler={surfaceSampler}
        weather={weather}
        visibleThrough={visibleThrough}
        onSelect={onSelect}
      />
      {quality === "low" ? (
        <>
          <FlowerField
            density={density}
            health={health}
            palette={palette}
            reducedMotion={reducedMotion}
            season={season}
            seed={seed + 233}
            stats={stats}
            surfaceSampler={surfaceSampler}
            weather={weather}
            onSelect={onSelect}
          />
          <TreeGrove
            density={density}
            health={health}
            palette={palette}
            quality={quality}
            reducedMotion={reducedMotion}
            season={season}
            seed={seed + 401}
            stats={stats}
            timeOfDay={timeOfDay}
            weather={weather}
            onSelect={onSelect}
          />
          <Wildlife
            density={density}
            health={health}
            palette={palette}
            reducedMotion={reducedMotion}
            season={season}
            seed={seed + 701}
            stats={stats}
            timeOfDay={timeOfDay}
          />
        </>
      ) : null}
      <WeatherSystem
        density={density}
        palette={palette}
        quality={quality}
        reducedMotion={reducedMotion}
        seed={seed + 997}
        season={season}
        timeOfDay={timeOfDay}
        weather={weather}
      />

      {walkthrough ? (
        <GardenWalkthroughControls
          input={walkInput}
          onExit={onWalkthroughExit}
          surfaceSampler={surfaceSampler}
        />
      ) : flythrough ? (
        <CameraFlythrough
          reducedMotion={reducedMotion}
          onComplete={onFlythroughComplete}
        />
      ) : (
        <OrbitControls
          enableDamping
          dampingFactor={0.055}
          enablePan={false}
          maxDistance={34}
          minDistance={12}
          maxPolarAngle={Math.PI * 0.47}
          minPolarAngle={Math.PI * 0.19}
          rotateSpeed={0.55}
          target={[0, -0.18, 0]}
          zoomSpeed={0.65}
        />
      )}
    </>
  );
}

function useCursorHandlers() {
  return useMemo(
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
}

function AtmosphereDome({
  palette,
  quality,
  timeOfDay,
}: {
  palette: GardenPalette;
  quality: GardenQuality;
  timeOfDay: GardenTimeOfDay;
}) {
  const geometry = useMemo(() => {
    const widthSegments = quality === "high" ? 48 : quality === "medium" ? 36 : 24;
    const sphere = new THREE.SphereGeometry(54, widthSegments, Math.round(widthSegments / 2));
    const positions = sphere.getAttribute("position") as THREE.BufferAttribute;
    const colors = new Float32Array(positions.count * 3);
    const sky = new THREE.Color(palette.sky);
    const horizon = new THREE.Color(palette.horizon);
    const fog = new THREE.Color(palette.fog);
    const zenith = sky.clone().multiplyScalar(timeOfDay === "night" ? 0.68 : 0.92);

    for (let index = 0; index < positions.count; index += 1) {
      const normalizedY = positions.getY(index) / 54;
      const horizonMix = clamp01((normalizedY + 0.12) / 0.82);
      const color = horizon.clone().lerp(zenith, horizonMix * horizonMix);
      if (normalizedY < -0.08) {
        color.lerp(fog, clamp01((-normalizedY - 0.08) * 2.8));
      }
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }

    sphere.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return sphere;
  }, [palette.fog, palette.horizon, palette.sky, quality, timeOfDay]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={-100}>
      <meshBasicMaterial
        depthTest={false}
        depthWrite={false}
        fog={false}
        side={THREE.BackSide}
        toneMapped={false}
        vertexColors
      />
    </mesh>
  );
}

function CloudLayer({
  density,
  palette,
  quality,
  reducedMotion,
  seed,
  timeOfDay,
  weather,
}: {
  density: number;
  palette: GardenPalette;
  quality: GardenQuality;
  reducedMotion: boolean;
  seed: number;
  timeOfDay: GardenTimeOfDay;
  weather: GardenWeather;
}) {
  const group = useRef<THREE.Group>(null);
  const cloudCount = Math.max(
    2,
    Math.round((quality === "high" ? 7 : quality === "medium" ? 5 : 3) * density),
  );
  const clouds = useMemo(() => {
    const random = seededRandom(seed);
    return Array.from({ length: cloudCount }, (_, index) => {
      const angle = (index / cloudCount) * Math.PI * 2 + random() * 0.55;
      const radius = 16 + random() * 12;
      return {
        x: Math.cos(angle) * radius,
        y: 7.2 + random() * 5.2,
        z: Math.sin(angle) * radius,
        rotation: random() * Math.PI * 2,
        scale: 1.2 + random() * 1.9,
      };
    });
  }, [cloudCount, seed]);
  const cloudColor = useMemo(() => {
    const base = new THREE.Color(palette.fog);
    if (weather === "rain") base.lerp(new THREE.Color("#526b74"), 0.48);
    if (timeOfDay === "night") base.multiplyScalar(0.48);
    return `#${base.getHexString()}`;
  }, [palette.fog, timeOfDay, weather]);
  const opacity = weather === "rain" ? 0.48 : weather === "fog" ? 0.36 : 0.22;

  useFrame((state) => {
    if (!group.current || reducedMotion) return;
    group.current.rotation.y = state.clock.elapsedTime * (weather === "wind" ? 0.018 : 0.006);
    group.current.position.y = Math.sin(state.clock.elapsedTime * 0.12) * 0.08;
  });

  return (
    <group ref={group}>
      {clouds.map((cloud, index) => (
        <group
          key={index}
          position={[cloud.x, cloud.y, cloud.z]}
          rotation={[0, cloud.rotation, 0]}
          scale={cloud.scale}
        >
          <mesh scale={[1.9, 0.52, 0.78]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial
              color={cloudColor}
              depthWrite={false}
              opacity={opacity}
              roughness={1}
              transparent
            />
          </mesh>
          <mesh position={[1.15, 0.08, 0.08]} scale={[1.28, 0.42, 0.62]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial
              color={cloudColor}
              depthWrite={false}
              opacity={opacity * 0.86}
              roughness={1}
              transparent
            />
          </mesh>
          <mesh position={[-1.2, -0.05, -0.03]} scale={[1.18, 0.36, 0.58]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial
              color={cloudColor}
              depthWrite={false}
              opacity={opacity * 0.8}
              roughness={1}
              transparent
            />
          </mesh>
        </group>
      ))}
      {weather === "fog" ? (
        <FogWisps color={palette.fog} quality={quality} reducedMotion={reducedMotion} seed={seed + 37} />
      ) : null}
    </group>
  );
}

function FogWisps({
  color,
  quality,
  reducedMotion,
  seed,
}: {
  color: string;
  quality: GardenQuality;
  reducedMotion: boolean;
  seed: number;
}) {
  const group = useRef<THREE.Group>(null);
  const wisps = useMemo(() => {
    const random = seededRandom(seed);
    const count = quality === "high" ? 8 : quality === "medium" ? 6 : 4;
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 + random() * 0.65;
      const radius = 6.5 + random() * 6.5;
      return {
        x: Math.cos(angle) * radius,
        y: 0.75 + random() * 1.4,
        z: Math.sin(angle) * radius,
        rotation: random() * Math.PI,
        scale: 1.5 + random() * 2.4,
      };
    });
  }, [quality, seed]);

  useFrame((state) => {
    if (!group.current || reducedMotion) return;
    group.current.rotation.y = state.clock.elapsedTime * 0.008;
    group.current.position.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.22;
  });

  return (
    <group ref={group}>
      {wisps.map((wisp, index) => (
        <mesh
          key={index}
          position={[wisp.x, wisp.y, wisp.z]}
          rotation={[0, wisp.rotation, 0]}
          scale={[wisp.scale * 1.9, wisp.scale * 0.2, wisp.scale]}
          renderOrder={2}
        >
          <sphereGeometry args={[1, 12, 7]} />
          <meshBasicMaterial
            color={color}
            depthWrite={false}
            opacity={0.075}
            transparent
          />
        </mesh>
      ))}
    </group>
  );
}

function CelestialBody({
  blocky = false,
  timeOfDay,
  palette,
}: {
  blocky?: boolean;
  timeOfDay: GardenTimeOfDay;
  palette: GardenPalette;
}) {
  const isNight = timeOfDay === "night";
  const radius = isNight ? 1.05 : 1.35;
  return (
    <group position={isNight ? [-10, 13, -15] : [12, 15, -17]}>
      <mesh>
        {blocky ? (
          <boxGeometry args={[radius * 1.65, radius * 1.65, radius * 0.34]} />
        ) : (
          <sphereGeometry args={[radius, 20, 20]} />
        )}
        <meshBasicMaterial color={palette.sun} fog={false} toneMapped={false} />
      </mesh>
      <mesh scale={1.55}>
        {blocky ? (
          <boxGeometry args={[radius * 1.65, radius * 1.65, radius * 0.34]} />
        ) : (
          <sphereGeometry args={[radius, 16, 16]} />
        )}
        <meshBasicMaterial
          color={palette.sun}
          fog={false}
          opacity={0.1}
          transparent
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function IslandTerrain({
  health,
  palette,
  quality,
  reducedMotion,
  season,
  seed,
  stats,
  surfaceSampler,
  timeOfDay,
  weather,
  onSelect,
}: {
  health: number;
  palette: GardenPalette;
  quality: GardenQuality;
  reducedMotion: boolean;
  season: GardenSeason;
  seed: number;
  stats: GardenStats;
  surfaceSampler: PhotorealIslandSurfaceSampler;
  timeOfDay: GardenTimeOfDay;
  weather: GardenWeather;
  onSelect?: (selection: GardenSelection | null) => void;
}) {
  const healthyGround = useMemo(() => {
    const color = new THREE.Color(palette.groundDry);
    color.lerp(new THREE.Color(palette.ground), 0.54 + health * 0.34);
    return `#${color.getHexString()}`;
  }, [health, palette.ground, palette.groundDry]);
  const soilColor = useMemo(() => {
    const color = new THREE.Color(palette.earth);
    color.lerp(new THREE.Color(palette.groundDry), 0.2);
    return `#${color.getHexString()}`;
  }, [palette.earth, palette.groundDry]);
  const terrainGeometry = useMemo(
    () => (quality === "medium" ? undefined : createIslandGeometry(quality, seed)),
    [quality, seed],
  );

  useEffect(
    () => () => {
      terrainGeometry?.dispose();
    },
    [terrainGeometry],
  );

  if (quality === "medium") {
    return (
      <VoxelTerrain
        health={health}
        palette={palette}
        season={season}
        seed={seed}
        stats={stats}
        surfaceOffset={ISLAND_SURFACE_OFFSET}
        surfaceSampler={surfaceSampler}
        timeOfDay={timeOfDay}
        onSelect={onSelect}
      />
    );
  }

  return (
    <group>
      <mesh
        castShadow
        receiveShadow
        geometry={terrainGeometry}
        position={[0, -0.7, 0]}
      >
        <meshStandardMaterial
          attach="material-0"
          color={palette.cliff}
          flatShading
          roughness={0.98}
          vertexColors
        />
        <meshStandardMaterial
          attach="material-1"
          color={healthyGround}
          roughness={0.97}
          vertexColors
        />
        <meshStandardMaterial
          attach="material-2"
          color={soilColor}
          flatShading
          roughness={1}
          vertexColors
        />
      </mesh>

      {quality === "low" ? (
        <CliffStrata palette={palette} quality={quality} seed={seed + 19} />
      ) : null}

      <PondWater
        health={health}
        palette={palette}
        quality={quality}
        reducedMotion={reducedMotion}
        seed={seed + 83}
        season={season}
        stats={stats}
        surfaceSampler={surfaceSampler}
        timeOfDay={timeOfDay}
        weather={weather}
        onSelect={onSelect}
      />
    </group>
  );
}

function CliffStrata({
  palette,
  quality,
  seed,
}: {
  palette: GardenPalette;
  quality: GardenQuality;
  seed: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = quality === "high" ? 52 : quality === "medium" ? 38 : 24;
  const strata = useMemo(() => {
    const random = seededRandom(seed);
    return Array.from({ length: count }, (_, index) => {
      const level = index % 3;
      const angle = (index / count) * Math.PI * 2 + random() * 0.1;
      const y = -0.3 - level * 0.31 + (random() - 0.5) * 0.07;
      const verticalMix = clamp01((-y - 0.16) / 1.05);
      const radius = THREE.MathUtils.lerp(7.65, 6.86, verticalMix);
      return {
        angle,
        radius,
        y,
        length: 0.48 + random() * 0.56,
        thickness: 0.025 + random() * 0.05,
      };
    });
  }, [count, seed]);
  const strataColor = useMemo(() => {
    const color = new THREE.Color(palette.cliff);
    color.lerp(new THREE.Color(palette.stoneLight), 0.18);
    return `#${color.getHexString()}`;
  }, [palette.cliff, palette.stoneLight]);

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D();
    strata.forEach((stratum, index) => {
      dummy.position.set(
        Math.cos(stratum.angle) * stratum.radius,
        stratum.y,
        Math.sin(stratum.angle) * stratum.radius,
      );
      dummy.rotation.set(0, -stratum.angle, (index % 2 ? 1 : -1) * 0.03);
      dummy.scale.set(stratum.length, stratum.thickness, 0.075);
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(index, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [strata]);

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, strata.length]}
      castShadow={quality === "high"}
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={strataColor} roughness={1} />
    </instancedMesh>
  );
}

function PondWater({
  health,
  palette,
  quality,
  reducedMotion,
  seed,
  season,
  stats,
  surfaceSampler,
  timeOfDay,
  weather,
  onSelect,
}: {
  health: number;
  palette: GardenPalette;
  quality: GardenQuality;
  reducedMotion: boolean;
  seed: number;
  season: GardenSeason;
  stats: GardenStats;
  surfaceSampler?: PhotorealIslandSurfaceSampler;
  timeOfDay: GardenTimeOfDay;
  weather: GardenWeather;
  onSelect?: (selection: GardenSelection | null) => void;
}) {
  const water = useRef<THREE.Mesh>(null);
  const rippleOne = useRef<THREE.Mesh>(null);
  const rippleTwo = useRef<THREE.Mesh>(null);
  const waterGeometry = useMemo(
    () =>
      createOrganicPondGeometry(
        seed + 17,
        quality === "high" ? 96 : quality === "medium" ? 64 : 40,
      ),
    [quality, seed],
  );
  const bankGeometry = useMemo(
    () =>
      createOrganicPondGeometry(
        seed + 31,
        quality === "high" ? 96 : quality === "medium" ? 64 : 40,
        1.08,
      ),
    [quality, seed],
  );
  const waterNormalMap = useMemo(
    () =>
      createWaterNormalTexture(
        seed + 47,
        quality === "high" ? 128 : quality === "medium" ? 96 : 64,
      ),
    [quality, seed],
  );
  const cursorHandlers = useCursorHandlers();
  const isFrozen = season === "winter";
  const pondSurfaceY =
    (surfaceSampler?.(POND_X, POND_Z) ?? 0) +
    ISLAND_SURFACE_OFFSET +
    0.2;
  const waterColor = useMemo(() => {
    const murky = new THREE.Color("#56635a");
    return `#${murky.lerp(new THREE.Color(palette.water), 0.18 + health * 0.5).getHexString()}`;
  }, [health, palette.water]);

  useEffect(
    () => () => {
      waterGeometry.dispose();
      bankGeometry.dispose();
      waterNormalMap.dispose();
    },
    [bankGeometry, waterGeometry, waterNormalMap],
  );

  useFrame((state) => {
    if (!water.current) return;
    const time = state.clock.elapsedTime;
    if (!reducedMotion && !isFrozen) {
      const surfaceSpeed =
        weather === "wind" ? 0.018 : weather === "rain" ? 0.012 : 0.006;
      const material = water.current.material as THREE.MeshStandardMaterial;
      if (material.normalMap) {
        material.normalMap.offset.x = time * surfaceSpeed;
        material.normalMap.offset.y = time * surfaceSpeed * 0.63;
      }
    }
    if (reducedMotion) return;
    if (rippleOne.current) {
      const phase = (time * 0.17) % 1;
      rippleOne.current.scale.setScalar(0.65 + phase * 0.8);
      const material = rippleOne.current.material as THREE.MeshBasicMaterial;
      material.opacity = (1 - phase) * 0.22;
    }
    if (rippleTwo.current) {
      const phase = (time * 0.14 + 0.52) % 1;
      rippleTwo.current.scale.setScalar(0.55 + phase * 0.65);
      const material = rippleTwo.current.material as THREE.MeshBasicMaterial;
      material.opacity = (1 - phase) * 0.18;
    }
  });

  const selectWater = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect?.({
      kind: "water",
      id: "activity-pond",
      title: isFrozen ? "Frozen activity pond" : "Activity pond",
      subtitle: "Recent activity",
      description:
        health > 0.62
          ? "Recent momentum keeps the garden water bright and clear."
          : "The pond grows quieter during slower contribution seasons.",
      accent: palette.waterGlow,
      worldPosition: [POND_X, pondSurfaceY + 0.08, POND_Z],
      count: stats.totalContributions,
      details: [
        { label: "Garden health", value: `${Math.round(health * 100)}%` },
        { label: "Contributions", value: stats.totalContributions.toLocaleString() },
        { label: "Repositories", value: stats.repositories },
      ],
    });
  };

  return (
    <group position={[POND_X, pondSurfaceY, POND_Z]}>
      <mesh
        receiveShadow
        geometry={bankGeometry}
        position={[0, -0.13, 0]}
        renderOrder={0}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[2.08, 1.34, 1]}
      >
        <meshStandardMaterial
          color="#685b4e"
          flatShading
          polygonOffset
          polygonOffsetFactor={1}
          roughness={1}
        />
      </mesh>
      <mesh
        ref={water}
        geometry={waterGeometry}
        position={[0, 0.012, 0]}
        renderOrder={2}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[1.96, 1.2, 1]}
        onClick={selectWater}
        {...cursorHandlers}
      >
        <meshStandardMaterial
          color={isFrozen ? palette.waterGlow : waterColor}
          depthWrite={false}
          emissive={timeOfDay === "night" ? "#15221f" : "#000000"}
          emissiveIntensity={
            isFrozen
              ? 0.035
              : timeOfDay === "night"
                ? 0.025 + health * 0.02
                : 0
          }
          metalness={isFrozen ? 0.08 : 0.03}
          normalMap={isFrozen ? undefined : waterNormalMap}
          normalScale={new THREE.Vector2(0.3, 0.3)}
          opacity={isFrozen ? 0.95 : 0.9}
          roughness={
            isFrozen
              ? 0.32
              : weather === "rain" || weather === "wind"
                ? 0.3
                : 0.22
          }
          transparent
        />
      </mesh>
      {!isFrozen ? (
        <>
          <PondBankPlants
            health={health}
            palette={palette}
            quality={quality}
            seed={seed}
          />
          {quality === "low" ? (
            <>
              <mesh
                ref={rippleOne}
                position={[0.28, 0.03, 0.08]}
                renderOrder={3}
                rotation={[-Math.PI / 2, 0, 0]}
              >
                <ringGeometry args={[0.18, 0.205, 28]} />
                <meshBasicMaterial
                  color={palette.waterGlow}
                  depthWrite={false}
                  opacity={0.18}
                  transparent
                />
              </mesh>
              <mesh
                ref={rippleTwo}
                position={[-0.52, 0.032, -0.22]}
                renderOrder={3}
                rotation={[-Math.PI / 2, 0, 0]}
              >
                <ringGeometry args={[0.15, 0.175, 28]} />
                <meshBasicMaterial
                  color={palette.waterGlow}
                  depthWrite={false}
                  opacity={0.16}
                  transparent
                />
              </mesh>
              {health > 0.42 ? <PondFish count={2} /> : null}
            </>
          ) : null}
        </>
      ) : (
        <mesh
          position={[0.2, 0.034, 0.1]}
          renderOrder={3}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.38, 0.405, 6]} />
          <meshBasicMaterial color="#efffff" opacity={0.35} transparent />
        </mesh>
      )}
    </group>
  );
}

function PondBankPlants({
  health,
  palette,
  quality,
  seed,
}: {
  health: number;
  palette: GardenPalette;
  quality: GardenQuality;
  seed: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(
    () => createGrassBladeGeometry(quality === "high" ? "high" : "low"),
    [quality],
  );
  const reeds = useMemo(() => {
    const random = seededRandom(seed);
    const count = quality === "high" ? 28 : quality === "medium" ? 20 : 24;
    const patchCenters = [-0.55, 1.72, 3.55, 5.15].map(
      (angle) => angle + (random() - 0.5) * 0.35,
    );
    return Array.from({ length: count }, () => {
      const center =
        patchCenters[Math.floor(random() * patchCenters.length)] ?? 0;
      const angle = center + (random() - random()) * 0.42;
      const bank = 0.97 + random() * 0.15;
      return {
        x: Math.cos(angle) * 2.02 * bank,
        z: Math.sin(angle) * 1.26 * bank,
        rotation: angle + Math.PI / 2 + (random() - 0.5) * 0.4,
        scale: 0.42 + random() * 0.5,
        shade: Math.floor(random() * 3),
      };
    });
  }, [quality, seed]);
  const colors = useMemo(() => {
    const damp = new THREE.Color("#355f48");
    return [
      damp.clone().lerp(new THREE.Color(palette.foliage[0]), health * 0.45),
      damp.clone().lerp(new THREE.Color(palette.foliage[1]), 0.3 + health * 0.4),
      damp.clone().lerp(new THREE.Color(palette.foliage[2]), 0.24 + health * 0.5),
    ];
  }, [health, palette.foliage]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D();
    reeds.forEach((reed, index) => {
      dummy.position.set(reed.x, 0.012, reed.z);
      dummy.rotation.set(0, reed.rotation, (index % 2 ? 1 : -1) * 0.035);
      dummy.scale.set(0.5, 0.34 + reed.scale * 0.48, 0.5);
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(index, dummy.matrix);
      mesh.current?.setColorAt(index, colors[reed.shade]);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [colors, reeds]);

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, reeds.length]}
      castShadow={quality === "high"}
    >
      <meshStandardMaterial
        roughness={0.9}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}

function PondFish({ count }: { count: number }) {
  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!group.current) return;
    group.current.rotation.y = state.clock.elapsedTime * 0.24;
  });

  return (
    <group ref={group} position={[0, 0.006, 0]}>
      {Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2;
        return (
          <group
            key={index}
            position={[Math.cos(angle) * (0.45 + index * 0.1), 0, Math.sin(angle) * 0.35]}
            rotation={[0, -angle + Math.PI / 2, 0]}
          >
            <mesh scale={[0.16, 0.035, 0.06]}>
              <sphereGeometry args={[1, 8, 5]} />
              <meshBasicMaterial color={index % 2 ? "#f4cf72" : "#f08b65"} />
            </mesh>
            <mesh position={[-0.16, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.08, 0.055, 0.03]}>
              <coneGeometry args={[1, 1, 3]} />
              <meshBasicMaterial color={index % 2 ? "#f4cf72" : "#f08b65"} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function StonePath({
  palette,
  quality,
  seed,
  surfaceSampler,
}: {
  palette: GardenPalette;
  quality: GardenQuality;
  seed: number;
  surfaceSampler: PhotorealIslandSurfaceSampler;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const stones = useMemo(() => {
    const random = seededRandom(seed);
    return Array.from({ length: 14 }, (_, index) => {
      const progress = index / 13;
      const x = -6.9 + progress * 13.4;
      const z =
        -0.22 * x -
        2.3 +
        Math.sin(progress * Math.PI * 2.15) * 0.42;
      return {
        x: x + (random() - 0.5) * 0.18,
        z: z + (random() - 0.5) * 0.16,
        rotation: random() * Math.PI,
        scale: 0.82 + random() * 0.38,
      };
    });
  }, [seed]);

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D();
    stones.forEach((stone, index) => {
      const surfaceY =
        (surfaceSampler(stone.x, stone.z) ?? 0) + ISLAND_SURFACE_OFFSET;
      dummy.position.set(stone.x, surfaceY + 0.025, stone.z);
      dummy.rotation.set(
        (index % 3 - 1) * 0.025,
        stone.rotation,
        (index % 2 ? 1 : -1) * 0.035,
      );
      dummy.scale.set(
        stone.scale * 0.43,
        stone.scale * 0.085,
        stone.scale * 0.34,
      );
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(index, dummy.matrix);
      mesh.current?.setColorAt(
        index,
        new THREE.Color(index % 4 === 0 ? palette.stoneLight : palette.stone),
      );
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [palette.stone, palette.stoneLight, stones, surfaceSampler]);

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, stones.length]}
      castShadow={quality === "high"}
      receiveShadow
    >
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial
        flatShading
        roughness={0.98}
      />
    </instancedMesh>
  );
}

function GroundDetails({
  health,
  palette,
  quality,
  season,
  seed,
}: {
  health: number;
  palette: GardenPalette;
  quality: GardenQuality;
  season: GardenSeason;
  seed: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = quality === "high" ? 58 : quality === "medium" ? 40 : 24;
  const details = useMemo(
    () => createScatter(count, seed, 7.05, 1.28),
    [count, seed],
  );
  const colors = useMemo(() => {
    const healthy = new THREE.Color(palette.foliage[2]);
    const dry = new THREE.Color(palette.groundDry);
    const winter = new THREE.Color(palette.stoneLight);
    const base = dry.clone().lerp(healthy, 0.2 + health * 0.6);
    if (season === "winter") base.lerp(winter, 0.55);

    return [
      base.clone().multiplyScalar(0.82),
      base.clone(),
      base.clone().lerp(new THREE.Color(palette.ground), 0.45),
      base.clone().lerp(new THREE.Color(palette.earth), 0.28),
    ];
  }, [health, palette, season]);

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D();
    details.forEach((detail, index) => {
      const size = 0.12 * detail.scale;
      dummy.position.set(detail.x, 0.045 + size * 0.18, detail.z);
      dummy.rotation.set(0, detail.rotation, 0);
      dummy.scale.set(size * 1.35, size * 0.34, size);
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(index, dummy.matrix);
      mesh.current?.setColorAt(index, colors[detail.variant % colors.length]);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [colors, details]);

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, details.length]}
      castShadow={quality === "high"}
      receiveShadow
    >
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial roughness={1} />
    </instancedMesh>
  );
}

function EdgeUnderstory({
  health,
  palette,
  quality,
  season,
  seed,
}: {
  health: number;
  palette: GardenPalette;
  quality: GardenQuality;
  season: GardenSeason;
  seed: number;
}) {
  const lowerMesh = useRef<THREE.InstancedMesh>(null);
  const upperMesh = useRef<THREE.InstancedMesh>(null);
  const count = quality === "high" ? 54 : quality === "medium" ? 38 : 24;
  const shrubs = useMemo(
    () => createEdgeScatter(count, seed),
    [count, seed],
  );
  const colors = useMemo(() => {
    const dry = new THREE.Color(palette.groundDry);
    return palette.foliage.map((value, index) => {
      const color = dry.clone().lerp(new THREE.Color(value), 0.38 + health * 0.58);
      if (season === "winter") {
        color.lerp(new THREE.Color(palette.stoneLight), 0.18 + index * 0.05);
      }
      return color;
    });
  }, [health, palette, season]);

  useLayoutEffect(() => {
    if (!lowerMesh.current || !upperMesh.current) return;
    const dummy = new THREE.Object3D();
    shrubs.forEach((shrub, index) => {
      const edgeScale = 0.82 + (WORLD_RADIUS - shrub.radius) * 0.08;
      const size = shrub.scale * edgeScale;

      dummy.position.set(shrub.x, 0.11 + size * 0.08, shrub.z);
      dummy.rotation.set(0, shrub.rotation, 0);
      dummy.scale.set(size * 0.24, size * 0.14, size * 0.2);
      dummy.updateMatrix();
      lowerMesh.current?.setMatrixAt(index, dummy.matrix);
      lowerMesh.current?.setColorAt(
        index,
        colors[(shrub.variant + 1) % colors.length],
      );

      dummy.position.set(
        shrub.x + Math.cos(shrub.rotation) * size * 0.08,
        0.22 + size * 0.12,
        shrub.z + Math.sin(shrub.rotation) * size * 0.08,
      );
      dummy.rotation.set(0, -shrub.rotation * 0.7, 0);
      dummy.scale.set(size * 0.17, size * 0.2, size * 0.17);
      dummy.updateMatrix();
      upperMesh.current?.setMatrixAt(index, dummy.matrix);
      upperMesh.current?.setColorAt(index, colors[shrub.variant % colors.length]);
    });

    lowerMesh.current.instanceMatrix.needsUpdate = true;
    upperMesh.current.instanceMatrix.needsUpdate = true;
    if (lowerMesh.current.instanceColor) {
      lowerMesh.current.instanceColor.needsUpdate = true;
    }
    if (upperMesh.current.instanceColor) {
      upperMesh.current.instanceColor.needsUpdate = true;
    }
  }, [colors, shrubs]);

  return (
    <group>
      <instancedMesh
        ref={lowerMesh}
        args={[undefined, undefined, shrubs.length]}
        castShadow={quality !== "low"}
        receiveShadow
      >
        <sphereGeometry args={[1, 9, 6]} />
        <meshStandardMaterial roughness={0.98} />
      </instancedMesh>
      <instancedMesh
        ref={upperMesh}
        args={[undefined, undefined, shrubs.length]}
        castShadow={quality === "high"}
      >
        <sphereGeometry args={[1, 9, 6]} />
        <meshStandardMaterial roughness={0.95} />
      </instancedMesh>
    </group>
  );
}

function RimRocks({
  palette,
  quality,
  seed,
}: {
  palette: GardenPalette;
  quality: GardenQuality;
  seed: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = quality === "high" ? 34 : quality === "medium" ? 27 : 20;
  const rocks = useMemo(() => {
    const random = seededRandom(seed);
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 + random() * 0.12;
      const radius = 7.48 + random() * 0.26;
      return {
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        rotation: random() * Math.PI,
        scale: 0.45 + random() * 0.55,
      };
    });
  }, [count, seed]);

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D();
    rocks.forEach((rock, index) => {
      dummy.position.set(rock.x, -0.08 + rock.scale * 0.18, rock.z);
      dummy.rotation.set(rock.rotation * 0.25, rock.rotation, rock.rotation * 0.14);
      dummy.scale.set(rock.scale, rock.scale * 0.72, rock.scale * 0.84);
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(index, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [rocks]);

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, rocks.length]} castShadow receiveShadow>
      <icosahedronGeometry args={[0.5, 1]} />
      <meshStandardMaterial color={palette.stone} roughness={0.96} />
    </instancedMesh>
  );
}

function ContributionBedRibbons({
  days,
  health,
  palette,
  visibleThrough,
}: {
  days: GardenDay[];
  health: number;
  palette: GardenPalette;
  visibleThrough?: string;
}) {
  const years = useMemo(
    () =>
      Array.from(
        new Set(days.map((day) => Number(day.date.slice(0, 4)))),
      ).sort((a, b) => a - b),
    [days],
  );
  const ringSpacing =
    years.length <= 1 ? 0 : Math.min(0.62, 3.55 / (years.length - 1));
  const visibleYear = Number((visibleThrough ?? "9999").slice(0, 4));
  const soilColors = useMemo(() => {
    const earth = new THREE.Color(palette.earth);
    const dry = new THREE.Color(palette.groundDry);
    return [
      `#${earth.clone().lerp(dry, 0.2 + health * 0.12).getHexString()}`,
      `#${earth.clone().lerp(dry, 0.34 + health * 0.1).getHexString()}`,
    ];
  }, [health, palette.earth, palette.groundDry]);

  return (
    <group position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {years.map((year, index) => {
        if (year > visibleYear) return null;
        const radius = 3.12 + index * ringSpacing;
        return (
          <mesh key={year} receiveShadow>
            <ringGeometry
              args={[
                radius - 0.13,
                radius + 0.13,
                128,
                1,
                CONTRIBUTION_BED_START + index * 0.012,
                CONTRIBUTION_BED_LENGTH,
              ]}
            />
            <meshStandardMaterial
              color={soilColors[index % soilColors.length]}
              opacity={0.5}
              polygonOffset
              polygonOffsetFactor={1}
              roughness={1}
              transparent
            />
          </mesh>
        );
      })}
    </group>
  );
}

function GrassMeadow({
  days,
  density,
  health,
  palette,
  quality,
  reducedMotion,
  seed,
  stats,
  surfaceSampler,
  weather,
  visibleThrough,
  onSelect,
}: {
  days: GardenDay[];
  density: number;
  health: number;
  palette: GardenPalette;
  quality: GardenQuality;
  reducedMotion: boolean;
  seed: number;
  stats: GardenStats;
  surfaceSampler: PhotorealIslandSurfaceSampler;
  weather: GardenWeather;
  visibleThrough?: string;
  onSelect?: (selection: GardenSelection | null) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const patchMesh = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const cursorHandlers = useCursorHandlers();
  const bladeGeometry = useMemo(
    () => createGrassBladeGeometry(quality),
    [quality],
  );
  const grass = useMemo<ContributionPlantItem[]>(() => {
    if (days.length > 0) {
      return createContributionPlantings(days, density, seed, visibleThrough);
    }

    const count = Math.round(
      (55 + Math.min(420, Math.sqrt(Math.max(0, stats.commits)) * 8.5)) *
        density,
    );
    return createScatter(count, seed, 7.1, 1.08).map((item) => ({
      ...item,
      dayIndex: -1,
      level: 2,
    }));
  }, [days, density, seed, stats.commits, visibleThrough]);
  const colors = useMemo(() => {
    const dormant = new THREE.Color(palette.groundDry);
    return [
      dormant.clone().multiplyScalar(0.76),
      ...palette.foliage.map((color, index) =>
        dormant
          .clone()
          .lerp(
            new THREE.Color(color),
            0.38 + health * 0.48 + index * 0.035,
          ),
      ),
    ];
  }, [health, palette.foliage, palette.groundDry]);
  const weeklyPatches = useMemo(() => {
    if (days.length === 0 || quality !== "high") return [];
    const patches: Array<{
      x: number;
      z: number;
      scale: number;
      rotation: number;
      level: number;
    }> = [];

    for (let start = 0; start < days.length; start += 7) {
      const end = Math.min(days.length, start + 7);
      const weekDays = days
        .slice(start, end)
        .filter((day) => !visibleThrough || day.date <= visibleThrough);
      const weekPlants = grass.filter(
        (plant) => plant.dayIndex >= start && plant.dayIndex < end,
      );
      if (weekPlants.length === 0 || weekDays.length === 0) continue;
      const contributionCount = weekDays.reduce(
        (total, day) => total + day.count,
        0,
      );
      if (contributionCount === 0) continue;
      const random = seededRandom(hashString(`${seed}:week:${start}`));
      patches.push({
        x:
          weekPlants.reduce((total, plant) => total + plant.x, 0) /
          weekPlants.length,
        z:
          weekPlants.reduce((total, plant) => total + plant.z, 0) /
          weekPlants.length,
        scale: clamp(0.34 + Math.sqrt(contributionCount) * 0.045, 0.36, 0.82),
        rotation: random() * Math.PI,
        level: clamp(
          Math.max(...weekDays.map((day) => Math.round(day.level))),
          1,
          4,
        ),
      });
    }
    return patches;
  }, [days, grass, quality, seed, visibleThrough]);

  useEffect(() => () => bladeGeometry.dispose(), [bladeGeometry]);

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D();
    grass.forEach((blade, index) => {
      const height =
        blade.level === 0
          ? 0.025 + blade.scale * 0.035
          : (0.08 + blade.scale * 0.17) * (0.84 + health * 0.24);
      const surfaceY =
        (surfaceSampler(blade.x, blade.z) ?? 0) + ISLAND_SURFACE_OFFSET;
      dummy.position.set(blade.x, surfaceY + 0.012, blade.z);
      dummy.rotation.set(
        (blade.variant - 1.5) * 0.025,
        blade.rotation,
        (blade.variant % 2 ? 1 : -1) * 0.035,
      );
      dummy.scale.set(
        0.26 + blade.scale * 0.1,
        height,
        0.26 + blade.scale * 0.09,
      );
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(index, dummy.matrix);
      mesh.current?.setColorAt(index, colors[blade.level]);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;

    weeklyPatches.forEach((patch, index) => {
      const surfaceY =
        (surfaceSampler(patch.x, patch.z) ?? 0) + ISLAND_SURFACE_OFFSET;
      dummy.position.set(patch.x, surfaceY + 0.014, patch.z);
      dummy.rotation.set(-Math.PI / 2, 0, patch.rotation);
      dummy.scale.set(patch.scale, patch.scale * 0.62, 1);
      dummy.updateMatrix();
      patchMesh.current?.setMatrixAt(index, dummy.matrix);
      patchMesh.current?.setColorAt(index, colors[patch.level]);
    });
    if (patchMesh.current) {
      patchMesh.current.instanceMatrix.needsUpdate = true;
      if (patchMesh.current.instanceColor) {
        patchMesh.current.instanceColor.needsUpdate = true;
      }
    }
  }, [colors, grass, health, surfaceSampler, weeklyPatches]);

  useFrame((state) => {
    if (!group.current || reducedMotion || quality === "medium") return;
    const wind = weather === "wind" ? 1 : weather === "rain" ? 0.62 : 0.32;
    group.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.15) * 0.004 * wind;
    group.current.rotation.x = Math.cos(state.clock.elapsedTime * 0.82) * 0.002 * wind;
  });

  const selectGrass = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const instanceId = event.instanceId ?? 0;
    const item = grass[instanceId] ?? grass[0];
    if (!item) return;
    const day = item.dayIndex >= 0 ? days[item.dayIndex] : undefined;
    const contributionCount = day?.count ?? stats.commits;
    const title = day ? formatGardenDate(day.date) : "Commit meadow";
    const repositoryText = day?.repositories?.length
      ? day.repositories.join(", ")
      : `${stats.repositories} repositories feed this habitat`;
    const groundY =
      (surfaceSampler(item.x, item.z) ?? 0) + ISLAND_SURFACE_OFFSET;

    onSelect?.({
      kind: "contribution",
      id: day ? `day-${day.date}` : `meadow-${instanceId}`,
      title,
      subtitle: day ? "Daily activity plot" : "Commit meadow",
      description: day
        ? contributionCount > 0
          ? `${contributionCount} contribution${contributionCount === 1 ? "" : "s"} grew this plot in the ${day.date.slice(0, 4)} annual bed.`
          : "A quiet plot preserves the gap between active days."
        : "Every commit adds another living detail to this meadow.",
      accent: `#${colors[item.level].getHexString()}`,
      worldPosition: [item.x, groundY + 0.3, item.z],
      date: day?.date,
      count: contributionCount,
      repositories: day?.repositories,
      details: [
        ...(day ? [{ label: "Date", value: day.date }] : []),
        { label: day ? "Contributions" : "Commits", value: contributionCount },
        ...(day ? [{ label: "Intensity", value: `${clamp(day.level, 0, 4)}/4` }] : []),
        { label: "Repositories", value: repositoryText },
      ],
    });
  };

  return (
    <group ref={group}>
      <instancedMesh
        ref={patchMesh}
        args={[undefined, undefined, weeklyPatches.length]}
        receiveShadow
      >
        <circleGeometry args={[1, 12]} />
        <meshStandardMaterial
          polygonOffset
          polygonOffsetFactor={-1}
          roughness={1}
        />
      </instancedMesh>
      <instancedMesh
        ref={mesh}
        args={[bladeGeometry, undefined, grass.length]}
        castShadow={quality === "high" && grass.length < 1400}
        receiveShadow
        onClick={selectGrass}
        {...cursorHandlers}
      >
        <meshBasicMaterial
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}

function formatGardenDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function FlowerField({
  density,
  health,
  palette,
  reducedMotion,
  season,
  seed,
  stats,
  surfaceSampler,
  weather,
  onSelect,
}: {
  density: number;
  health: number;
  palette: GardenPalette;
  reducedMotion: boolean;
  season: GardenSeason;
  seed: number;
  stats: GardenStats;
  surfaceSampler: PhotorealIslandSurfaceSampler;
  weather: GardenWeather;
  onSelect?: (selection: GardenSelection | null) => void;
}) {
  const stems = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const centers = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const cursorHandlers = useCursorHandlers();
  const headGeometry = useMemo(() => createFlowerHeadGeometry(), []);
  const seasonFactor =
    season === "spring" ? 1.3 : season === "summer" ? 1 : season === "autumn" ? 0.62 : 0.24;
  const count = Math.max(
    3,
    Math.round(
      (4 + Math.min(116, Math.sqrt(Math.max(0, stats.issues)) * 10.5)) *
        seasonFactor *
        density *
        (0.5 + health * 0.5),
    ),
  );
  const flowers = useMemo(
    () => createFlowerClusters(count, seed),
    [count, seed],
  );

  useEffect(() => () => headGeometry.dispose(), [headGeometry]);

  useLayoutEffect(() => {
    if (!stems.current || !heads.current || !centers.current) return;
    const dummy = new THREE.Object3D();
    flowers.forEach((flower, index) => {
      const height =
        (0.2 + flower.scale * 0.11) * (season === "winter" ? 0.68 : 1);
      const surfaceY =
        (surfaceSampler(flower.x, flower.z) ?? 0) + ISLAND_SURFACE_OFFSET;

      dummy.position.set(flower.x, surfaceY + height * 0.5, flower.z);
      dummy.rotation.set(0, flower.rotation, 0);
      dummy.scale.set(0.68, height, 0.68);
      dummy.updateMatrix();
      stems.current?.setMatrixAt(index, dummy.matrix);
      stems.current?.setColorAt(
        index,
        new THREE.Color(index % 3 === 0 ? palette.foliage[2] : palette.foliage[1]),
      );

      dummy.position.set(flower.x, surfaceY + height + 0.02, flower.z);
      dummy.rotation.set(0.15, flower.rotation, flower.rotation * 0.06);
      dummy.scale.setScalar(0.1 + flower.scale * 0.055);
      dummy.scale.y *= 0.58;
      dummy.updateMatrix();
      heads.current?.setMatrixAt(index, dummy.matrix);
      heads.current?.setColorAt(index, new THREE.Color(palette.flowers[flower.variant]));

      dummy.position.set(flower.x, surfaceY + height + 0.045, flower.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.037 + flower.scale * 0.012);
      dummy.updateMatrix();
      centers.current?.setMatrixAt(index, dummy.matrix);
    });

    for (const mesh of [stems.current, heads.current, centers.current]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [flowers, palette.flowers, palette.foliage, season, surfaceSampler]);

  useFrame((state) => {
    if (!group.current || reducedMotion) return;
    const wind = weather === "wind" ? 1 : weather === "rain" ? 0.55 : 0.25;
    group.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.55 + 1.4) * 0.006 * wind;
  });

  const selectFlower = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const instanceId = event.instanceId ?? 0;
    const flower = flowers[instanceId] ?? flowers[0];
    if (!flower) return;
    const species = ["Wild rose", "Sunbell", "Violet star", "Moon daisy"];
    const groundY =
      (surfaceSampler(flower.x, flower.z) ?? 0) + ISLAND_SURFACE_OFFSET;

    onSelect?.({
      kind: "flower",
      id: `issue-flower-${instanceId}`,
      title: species[flower.variant],
      subtitle: "Issue border",
      description:
        "Current issue activity seeds clustered borders along the pond and walking path.",
      accent: palette.flowers[flower.variant],
      worldPosition: [flower.x, groundY + 0.55, flower.z],
      count: stats.issues,
      details: [
        { label: "Issue habitat total", value: stats.issues },
        { label: "Species", value: species[flower.variant] },
        { label: "Season", value: season[0].toUpperCase() + season.slice(1) },
      ],
    });
  };

  return (
    <group ref={group}>
      <instancedMesh ref={stems} args={[undefined, undefined, flowers.length]} castShadow>
        <cylinderGeometry args={[0.022, 0.03, 1, 5]} />
        <meshStandardMaterial roughness={0.88} />
      </instancedMesh>
      <instancedMesh
        ref={heads}
        args={[headGeometry, undefined, flowers.length]}
        castShadow
        onClick={selectFlower}
        {...cursorHandlers}
      >
        <meshStandardMaterial
          roughness={0.76}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh ref={centers} args={[undefined, undefined, flowers.length]} castShadow>
        <sphereGeometry args={[1, 6, 4]} />
        <meshStandardMaterial color="#f6cb62" emissive="#7b4c16" emissiveIntensity={0.05} />
      </instancedMesh>
    </group>
  );
}

type TreeSpecies = "oak" | "pine" | "birch" | "maple";

interface TreeBranch {
  start: VectorTuple;
  end: VectorTuple;
  radius: number;
  shade: number;
}

interface TreeFoliageTip {
  position: VectorTuple;
  rotation: VectorTuple;
  scale: VectorTuple;
  colorIndex: number;
  keep: number;
  snow: number;
  blossom: number;
  shade: number;
}

interface TreeStructure {
  species: TreeSpecies;
  branches: TreeBranch[];
  foliage: TreeFoliageTip[];
  crownPivot: VectorTuple;
  height: number;
}

interface TreeBatchItem {
  structure: TreeStructure;
  position: VectorTuple;
  rotation: number;
  scale: number;
  owner: number;
}

interface TreeRenderInstance {
  matrix: THREE.Matrix4;
  color: THREE.Color;
  owner: number;
  treeSlot: number;
}

interface TreeFoliageInstance extends TreeRenderInstance {
  localMatrix: THREE.Matrix4;
}

interface TreeAnimation {
  rootMatrix: THREE.Matrix4;
  pivotMatrix: THREE.Matrix4;
  inversePivotMatrix: THREE.Matrix4;
  phase: number;
}

const TREE_SPECIES: TreeSpecies[] = ["oak", "pine", "birch", "maple"];
const TREE_SPECIES_LABEL: Record<TreeSpecies, string> = {
  oak: "Oak",
  pine: "Pine",
  birch: "Birch",
  maple: "Maple",
};
const TREE_UP = new THREE.Vector3(0, 1, 0);

function tupleFromVector(vector: THREE.Vector3): VectorTuple {
  return [vector.x, vector.y, vector.z];
}

function treeScaleFor(item: TreeItem) {
  return item.scale * (0.86 + item.age * 0.2);
}

function addTreeBranch(
  branches: TreeBranch[],
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  shade: number,
) {
  branches.push({
    start: tupleFromVector(start),
    end: tupleFromVector(end),
    radius,
    shade,
  });
}

function addFoliageTip(
  foliage: TreeFoliageTip[],
  position: THREE.Vector3,
  scale: VectorTuple,
  angle: number,
  random: () => number,
) {
  foliage.push({
    position: tupleFromVector(position),
    rotation: [
      (random() - 0.5) * 0.55,
      angle + (random() - 0.5) * 0.7,
      (random() - 0.5) * 0.48,
    ],
    scale,
    colorIndex: Math.floor(random() * 4),
    keep: random(),
    snow: random(),
    blossom: random(),
    shade: random() - 0.5,
  });
}

function buildPineStructure(
  item: TreeItem,
  random: () => number,
  quality: GardenQuality,
): TreeStructure {
  const branches: TreeBranch[] = [];
  const foliage: TreeFoliageTip[] = [];
  const trunkSegments = quality === "high" ? 5 : quality === "medium" ? 4 : 3;
  const whorls = quality === "high" ? 5 : quality === "medium" ? 4 : 3;
  const branchesPerWhorl = quality === "high" ? 6 : quality === "medium" ? 5 : 4;
  const trunkTop = 2.72 + item.age * 0.18;
  const leanAngle = random() * Math.PI * 2;
  const leanAmount = 0.08 + random() * 0.08;
  const centerAt = (height: number) => {
    const progress = height / trunkTop;
    return new THREE.Vector3(
      Math.cos(leanAngle) * leanAmount * progress * progress,
      height,
      Math.sin(leanAngle) * leanAmount * progress * progress,
    );
  };

  let previous = centerAt(0);
  for (let index = 1; index <= trunkSegments; index += 1) {
    const progress = index / trunkSegments;
    const next = centerAt(trunkTop * progress);
    addTreeBranch(
      branches,
      previous,
      next,
      0.205 * (1 - progress * 0.62) + 0.028,
      random() - 0.5,
    );
    previous = next;
  }

  const rootCount = quality === "high" ? 5 : quality === "medium" ? 4 : 3;
  for (let index = 0; index < rootCount; index += 1) {
    const angle = (index / rootCount) * Math.PI * 2 + random() * 0.42;
    const length = 0.42 + random() * 0.22;
    addTreeBranch(
      branches,
      new THREE.Vector3(Math.cos(angle) * 0.04, 0.075, Math.sin(angle) * 0.04),
      new THREE.Vector3(Math.cos(angle) * length, 0.025, Math.sin(angle) * length),
      0.075 + random() * 0.025,
      random() - 0.5,
    );
  }

  for (let level = 0; level < whorls; level += 1) {
    const progress = level / Math.max(1, whorls - 1);
    const height = 0.72 + progress * (trunkTop - 1.08);
    const center = centerAt(height);
    const spread = 1.06 - progress * 0.55;

    for (let branchIndex = 0; branchIndex < branchesPerWhorl; branchIndex += 1) {
      const angle =
        (branchIndex / branchesPerWhorl) * Math.PI * 2 +
        level * 0.62 +
        (random() - 0.5) * 0.24;
      const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const joint = center
        .clone()
        .addScaledVector(direction, spread * 0.52)
        .add(new THREE.Vector3(0, 0.015 - progress * 0.055, 0));
      const tip = center
        .clone()
        .addScaledVector(direction, spread * (0.9 + random() * 0.16))
        .add(new THREE.Vector3(0, -0.04 - progress * 0.06, 0));

      addTreeBranch(
        branches,
        center,
        joint,
        0.07 * (1 - progress * 0.42) + 0.022,
        random() - 0.5,
      );
      addTreeBranch(
        branches,
        joint,
        tip,
        0.045 * (1 - progress * 0.36) + 0.014,
        random() - 0.5,
      );

      const clusterScale: VectorTuple = [
        0.34 + random() * 0.1,
        0.17 + random() * 0.06,
        0.5 + random() * 0.12,
      ];
      addFoliageTip(foliage, tip, clusterScale, angle, random);

      if (quality !== "low" && (branchIndex + level) % 2 === 0) {
        const middleTip = joint.clone().lerp(tip, 0.56);
        addFoliageTip(
          foliage,
          middleTip,
          [clusterScale[0] * 0.86, clusterScale[1] * 0.86, clusterScale[2] * 0.82],
          angle,
          random,
        );
      }
    }
  }

  const top = centerAt(trunkTop);
  addFoliageTip(foliage, top.clone().add(new THREE.Vector3(0, 0.08, 0)), [0.3, 0.52, 0.3], 0, random);

  return {
    species: "pine",
    branches,
    foliage,
    crownPivot: tupleFromVector(centerAt(trunkTop * 0.5)),
    height: trunkTop + 0.4,
  };
}

function buildBroadleafStructure(
  item: TreeItem,
  random: () => number,
  quality: GardenQuality,
  species: Exclude<TreeSpecies, "pine">,
  hero: boolean,
): TreeStructure {
  const branches: TreeBranch[] = [];
  const foliage: TreeFoliageTip[] = [];
  const trunkSegments = hero
    ? quality === "high"
      ? 5
      : 4
    : quality === "high"
      ? 4
      : 3;
  const trunkTop = hero
    ? 2.82
    : species === "birch"
      ? 2.46
      : species === "maple"
        ? 2.08
        : 1.92;
  const baseRadius = hero ? 0.42 : species === "birch" ? 0.17 : species === "maple" ? 0.245 : 0.27;
  const leanAngle = random() * Math.PI * 2;
  const leanAmount = hero ? 0.2 : species === "birch" ? 0.16 : 0.12 + random() * 0.12;
  const curvePhase = random() * Math.PI * 2;
  const centerAt = (height: number) => {
    const progress = height / trunkTop;
    const curve = Math.sin(progress * Math.PI + curvePhase) * leanAmount * 0.22;
    return new THREE.Vector3(
      Math.cos(leanAngle) * leanAmount * progress * progress +
        Math.cos(leanAngle + Math.PI / 2) * curve,
      height,
      Math.sin(leanAngle) * leanAmount * progress * progress +
        Math.sin(leanAngle + Math.PI / 2) * curve,
    );
  };

  let previous = centerAt(0);
  for (let index = 1; index <= trunkSegments; index += 1) {
    const progress = index / trunkSegments;
    const next = centerAt(trunkTop * progress);
    addTreeBranch(
      branches,
      previous,
      next,
      baseRadius * (1 - progress * 0.68) + (hero ? 0.055 : 0.034),
      random() - 0.5,
    );
    previous = next;
  }

  const rootCount = hero ? 7 : quality === "high" ? 5 : quality === "medium" ? 4 : 3;
  for (let index = 0; index < rootCount; index += 1) {
    const angle = (index / rootCount) * Math.PI * 2 + random() * 0.5;
    const length = (hero ? 0.78 : 0.5) * (0.78 + random() * 0.42);
    addTreeBranch(
      branches,
      new THREE.Vector3(Math.cos(angle) * 0.05, 0.08, Math.sin(angle) * 0.05),
      new THREE.Vector3(Math.cos(angle) * length, 0.025, Math.sin(angle) * length),
      (hero ? 0.125 : 0.085) * (0.82 + random() * 0.28),
      random() - 0.5,
    );
  }

  const branchCount = hero
    ? quality === "high"
      ? 12
      : quality === "medium"
        ? 9
        : 7
    : quality === "high"
      ? species === "birch"
        ? 8
        : 9
      : quality === "medium"
        ? 6
        : 4;
  const spread = hero ? 1.48 : species === "oak" ? 1.08 : species === "maple" ? 0.95 : 0.72;
  const rise = hero ? 0.64 : species === "birch" ? 0.72 : species === "maple" ? 0.66 : 0.5;
  const twigCount = quality === "high" || hero ? 2 : 1;
  const baseCluster: VectorTuple =
    species === "birch"
      ? [0.29, 0.45, 0.27]
      : species === "maple"
        ? [0.43, 0.52, 0.39]
        : hero
          ? [0.5, 0.46, 0.46]
          : [0.47, 0.4, 0.44];

  for (let index = 0; index < branchCount; index += 1) {
    const angle =
      (index / branchCount) * Math.PI * 2 +
      (random() - 0.5) * (hero ? 0.35 : 0.5);
    const tier = index % (hero ? 4 : 3);
    const anchorHeight =
      trunkTop * (hero ? 0.34 + tier * 0.105 : 0.42 + tier * 0.12) +
      (random() - 0.5) * 0.09;
    const anchor = centerAt(anchorHeight);
    const length = spread * (0.76 + random() * 0.34) * (1 - tier * 0.055);
    const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const joint = anchor
      .clone()
      .addScaledVector(direction, length * 0.5)
      .add(new THREE.Vector3(0, rise * 0.36, 0));
    const end = anchor
      .clone()
      .addScaledVector(direction, length)
      .add(new THREE.Vector3(0, rise * (0.72 + random() * 0.3), 0));

    addTreeBranch(
      branches,
      anchor,
      joint,
      baseRadius * (hero ? 0.46 : 0.4) * (0.9 + random() * 0.18),
      random() - 0.5,
    );
    addTreeBranch(
      branches,
      joint,
      end,
      baseRadius * (hero ? 0.28 : 0.25) * (0.86 + random() * 0.18),
      random() - 0.5,
    );

    for (let twigIndex = 0; twigIndex < twigCount; twigIndex += 1) {
      const forkDirection =
        angle +
        (twigIndex === 0 ? -1 : 1) * (0.24 + random() * 0.25) +
        (random() - 0.5) * 0.16;
      const twigLength = (hero ? 0.62 : 0.42) * (0.78 + random() * 0.38);
      const droop = species === "birch" && twigIndex % 2 === 1 ? -0.06 : 0.16 + random() * 0.18;
      const tip = end.clone().add(
        new THREE.Vector3(
          Math.cos(forkDirection) * twigLength,
          droop,
          Math.sin(forkDirection) * twigLength,
        ),
      );
      addTreeBranch(
        branches,
        end,
        tip,
        baseRadius * (hero ? 0.15 : 0.13) * (0.82 + random() * 0.24),
        random() - 0.5,
      );
      addFoliageTip(
        foliage,
        tip,
        [
          baseCluster[0] * (0.82 + random() * 0.34),
          baseCluster[1] * (0.8 + random() * 0.38),
          baseCluster[2] * (0.82 + random() * 0.34),
        ],
        forkDirection,
        random,
      );
    }

    if (quality === "high" && index % 2 === 0) {
      addFoliageTip(
        foliage,
        end,
        [baseCluster[0] * 0.78, baseCluster[1] * 0.7, baseCluster[2] * 0.78],
        angle,
        random,
      );
    }
  }

  const top = centerAt(trunkTop);
  const leaderCount = hero ? 5 : quality === "low" ? 2 : 3;
  for (let index = 0; index < leaderCount; index += 1) {
    const angle = (index / leaderCount) * Math.PI * 2 + random() * 0.6;
    const leaderTip = top.clone().add(
      new THREE.Vector3(
        Math.cos(angle) * (hero ? 0.48 : 0.3),
        (hero ? 0.68 : 0.48) + random() * 0.2,
        Math.sin(angle) * (hero ? 0.48 : 0.3),
      ),
    );
    addTreeBranch(
      branches,
      top,
      leaderTip,
      baseRadius * (hero ? 0.18 : 0.15),
      random() - 0.5,
    );
    addFoliageTip(
      foliage,
      leaderTip,
      [
        baseCluster[0] * (0.8 + random() * 0.2),
        baseCluster[1] * (0.88 + random() * 0.25),
        baseCluster[2] * (0.8 + random() * 0.2),
      ],
      angle,
      random,
    );
  }

  const height = foliage.reduce(
    (maximum, tip) => Math.max(maximum, tip.position[1] + tip.scale[1] * 0.8),
    trunkTop,
  );

  return {
    species,
    branches,
    foliage,
    crownPivot: tupleFromVector(centerAt(trunkTop * (hero ? 0.4 : 0.48))),
    height,
  };
}

function buildTreeStructure(
  item: TreeItem,
  index: number,
  quality: GardenQuality,
  hero = false,
): TreeStructure {
  const species = hero ? "oak" : TREE_SPECIES[item.variant % TREE_SPECIES.length];
  const random = seededRandom(
    hashString(
      `${hero ? "spirit" : "grove"}:${index}:${item.x.toFixed(3)}:${item.z.toFixed(3)}:${item.age.toFixed(3)}`,
    ),
  );

  if (species === "pine") {
    return buildPineStructure(item, random, quality);
  }
  return buildBroadleafStructure(item, random, quality, species, hero);
}

function createBranchMatrix(branch: TreeBranch) {
  const start = new THREE.Vector3(...branch.start);
  const end = new THREE.Vector3(...branch.end);
  const direction = end.clone().sub(start);
  const length = Math.max(0.001, direction.length());
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    TREE_UP,
    direction.normalize(),
  );
  return new THREE.Matrix4().compose(
    midpoint,
    quaternion,
    new THREE.Vector3(branch.radius, length, branch.radius),
  );
}

function createFoliageMatrix(tip: TreeFoliageTip) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...tip.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...tip.rotation)),
    new THREE.Vector3(...tip.scale),
  );
}

function createLeafSprayGeometry(quality: GardenQuality) {
  const leafCount = quality === "high" ? 14 : quality === "medium" ? 9 : 6;
  const positions: number[] = [];

  const pushTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  for (let index = 0; index < leafCount; index += 1) {
    const angle = index * 2.399963229728653;
    const verticalBand = ((index * 3) % leafCount) / Math.max(1, leafCount - 1);
    const radius = 0.1 + (index % 3) * 0.055;
    const center = new THREE.Vector3(
      Math.cos(angle) * radius,
      (verticalBand - 0.5) * 0.62,
      Math.sin(angle) * radius,
    );
    const direction = new THREE.Vector3(
      Math.cos(angle) * (0.5 + (index % 2) * 0.12),
      0.66 + ((index + 1) % 3) * 0.09,
      Math.sin(angle) * (0.5 + (index % 2) * 0.12),
    ).normalize();
    const side = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).normalize();
    const fold = side.clone().cross(direction).normalize();
    const length = 0.55 + (index % 4) * 0.055;
    const width = 0.19 + ((index + 2) % 3) * 0.035;
    const base = center.clone().addScaledVector(direction, -length * 0.48);
    const tip = center.clone().addScaledVector(direction, length * 0.52);
    const left = center.clone().addScaledVector(side, width);
    const right = center.clone().addScaledVector(side, -width);
    const ridge = center.clone().addScaledVector(fold, 0.045 + (index % 2) * 0.018);

    pushTriangle(base, left, ridge);
    pushTriangle(base, ridge, right);
    pushTriangle(left, tip, ridge);
    pushTriangle(ridge, tip, right);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function treeRootMatrix(tree: TreeBatchItem) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...tree.position),
    new THREE.Quaternion().setFromAxisAngle(TREE_UP, tree.rotation),
    new THREE.Vector3(tree.scale, tree.scale, tree.scale),
  );
}

function foliageFactor(
  species: TreeSpecies,
  season: GardenSeason,
  health: number,
  winterFoliage: number,
) {
  const seasonal =
    species === "pine"
      ? season === "winter"
        ? 0.84
        : season === "spring"
          ? 0.9
          : 1
      : season === "winter"
        ? winterFoliage
        : season === "spring"
          ? 0.76
          : season === "autumn"
            ? 0.72
            : 1;
  const vitality = health < 0.14 ? 0.16 : 0.54 + health * 0.46;
  return clamp01(seasonal * vitality);
}

function treeTrunkColor(
  palette: GardenPalette,
  species: TreeSpecies,
  shade: number,
) {
  const color = new THREE.Color("#d4bea9");
  if (species === "birch") color.set("#f1eee4");
  if (species === "pine") color.set("#a98f7b");
  if (species === "maple") color.set("#c9a28a");
  color.lerp(new THREE.Color(palette.trunk), 0.08);
  color.offsetHSL(0, 0, shade * 0.065);
  return color;
}

function treeLeafColor(
  palette: GardenPalette,
  species: TreeSpecies,
  season: GardenSeason,
  health: number,
  tip: TreeFoliageTip,
) {
  const paletteIndex =
    species === "pine"
      ? tip.colorIndex % 2
      : (tip.colorIndex + (species === "maple" ? 1 : 0)) % palette.foliage.length;
  const color = new THREE.Color(palette.foliage[paletteIndex]);

  if (season === "spring" && species !== "pine") {
    color.lerp(new THREE.Color("#a9d979"), 0.16);
  }
  if (species === "pine") {
    color.lerp(new THREE.Color("#214b3b"), 0.16);
  }
  color.lerp(new THREE.Color(palette.groundDry), (1 - health) * 0.28);
  color.offsetHSL(0, 0, tip.shade * 0.11);
  return color;
}

function ProceduralTreeBatch({
  trees,
  health,
  palette,
  quality,
  reducedMotion,
  season,
  weather,
  emissive = "#000000",
  emissiveIntensity = 0,
  winterFoliage = 0,
  onSelectOwner,
}: {
  trees: TreeBatchItem[];
  health: number;
  palette: GardenPalette;
  quality: GardenQuality;
  reducedMotion: boolean;
  season: GardenSeason;
  weather: GardenWeather;
  emissive?: string;
  emissiveIntensity?: number;
  winterFoliage?: number;
  onSelectOwner: (owner: number) => void;
}) {
  const branches = useRef<THREE.InstancedMesh>(null);
  const leaves = useRef<THREE.InstancedMesh>(null);
  const snow = useRef<THREE.InstancedMesh>(null);
  const blossoms = useRef<THREE.InstancedMesh>(null);
  const cursorHandlers = useCursorHandlers();
  const [barkColorMap, barkNormalMap, barkRoughnessMap] =
    useSurfaceTextureSet("bark", 1.4, 3.8);
  const leafGeometry = useMemo(() => createLeafSprayGeometry(quality), [quality]);

  useEffect(() => () => leafGeometry.dispose(), [leafGeometry]);

  const renderData = useMemo(() => {
    const branchInstances: TreeRenderInstance[] = [];
    const leafInstances: TreeFoliageInstance[] = [];
    const snowInstances: TreeRenderInstance[] = [];
    const blossomInstances: TreeRenderInstance[] = [];
    const animations: TreeAnimation[] = [];

    trees.forEach((tree, treeSlot) => {
      const rootMatrix = treeRootMatrix(tree);
      const pivot = new THREE.Vector3(...tree.structure.crownPivot);
      const pivotMatrix = new THREE.Matrix4().makeTranslation(
        pivot.x,
        pivot.y,
        pivot.z,
      );
      const inversePivotMatrix = new THREE.Matrix4().makeTranslation(
        -pivot.x,
        -pivot.y,
        -pivot.z,
      );
      animations.push({
        rootMatrix,
        pivotMatrix,
        inversePivotMatrix,
        phase: tree.rotation * 0.7 + tree.owner * 0.83 + treeSlot * 0.41,
      });

      tree.structure.branches.forEach((branch) => {
        branchInstances.push({
          matrix: rootMatrix.clone().multiply(createBranchMatrix(branch)),
          color: treeTrunkColor(
            palette,
            tree.structure.species,
            branch.shade,
          ),
          owner: tree.owner,
          treeSlot,
        });
      });

      const factor = foliageFactor(
        tree.structure.species,
        season,
        health,
        winterFoliage,
      );
      const minimumLeaves =
        factor <= 0 ? 0 : tree.structure.species === "pine" ? 3 : 2;

      tree.structure.foliage.forEach((tip, tipIndex) => {
        const isVisible = tipIndex < minimumLeaves || tip.keep <= factor;
        const localMatrix = createFoliageMatrix(tip);

        if (isVisible) {
          leafInstances.push({
            matrix: rootMatrix.clone().multiply(localMatrix),
            localMatrix,
            color: treeLeafColor(
              palette,
              tree.structure.species,
              season,
              health,
              tip,
            ),
            owner: tree.owner,
            treeSlot,
          });
        }

        if (
          season === "winter" &&
          tip.snow <
            (tree.structure.species === "pine"
              ? quality === "low"
                ? 0.28
                : 0.5
              : quality === "high"
                ? 0.28
                : 0.18)
        ) {
          const snowPosition = new THREE.Vector3(...tip.position);
          snowPosition.y += tip.scale[1] * 0.35;
          const snowMatrix = new THREE.Matrix4().compose(
            snowPosition,
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(0, tip.rotation[1], tip.rotation[2] * 0.2),
            ),
            new THREE.Vector3(
              tip.scale[0] * 0.72,
              0.045 + tip.scale[1] * 0.08,
              tip.scale[2] * 0.68,
            ),
          );
          snowInstances.push({
            matrix: rootMatrix.clone().multiply(snowMatrix),
            color: new THREE.Color("#eef6f3"),
            owner: tree.owner,
            treeSlot,
          });
        }

        if (
          season === "spring" &&
          quality !== "low" &&
          tree.structure.species !== "pine" &&
          health > 0.34 &&
          isVisible &&
          tip.blossom < 0.2
        ) {
          const blossomPosition = new THREE.Vector3(...tip.position).add(
            new THREE.Vector3(
              Math.cos(tip.rotation[1]) * tip.scale[0] * 0.38,
              tip.scale[1] * 0.32,
              Math.sin(tip.rotation[1]) * tip.scale[2] * 0.38,
            ),
          );
          const size = 0.075 + tip.blossom * 0.12;
          const blossomMatrix = new THREE.Matrix4().compose(
            blossomPosition,
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(tip.rotation[0], tip.rotation[1], tip.rotation[2]),
            ),
            new THREE.Vector3(size, size * 0.72, size),
          );
          blossomInstances.push({
            matrix: rootMatrix.clone().multiply(blossomMatrix),
            color: new THREE.Color(
              palette.flowers[(tip.colorIndex + tree.owner) % palette.flowers.length],
            ),
            owner: tree.owner,
            treeSlot,
          });
        }
      });
    });

    return {
      animations,
      branches: branchInstances,
      leaves: leafInstances,
      snow: snowInstances,
      blossoms: blossomInstances,
    };
  }, [
    health,
    palette,
    quality,
    season,
    trees,
    winterFoliage,
  ]);

  useLayoutEffect(() => {
    const syncInstances = (
      mesh: THREE.InstancedMesh | null,
      instances: TreeRenderInstance[],
      dynamic = false,
    ) => {
      if (!mesh) return;
      if (dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instances.forEach((instance, index) => {
        mesh.setMatrixAt(index, instance.matrix);
        mesh.setColorAt(index, instance.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };

    syncInstances(branches.current, renderData.branches);
    syncInstances(leaves.current, renderData.leaves, true);
    syncInstances(snow.current, renderData.snow);
    syncInstances(blossoms.current, renderData.blossoms);
  }, [renderData]);

  const windScratch = useMemo(
    () => ({
      rotation: new THREE.Matrix4(),
      rotationX: new THREE.Matrix4(),
      result: new THREE.Matrix4(),
    }),
    [],
  );

  useFrame((state) => {
    if (!leaves.current || reducedMotion || renderData.leaves.length === 0) return;
    const force =
      weather === "wind"
        ? 1
        : weather === "rain"
          ? 0.58
          : weather === "snow"
            ? 0.3
            : 0.2;
    const elapsed = state.clock.elapsedTime;

    renderData.leaves.forEach((leaf, index) => {
      const animation = renderData.animations[leaf.treeSlot];
      const sway =
        Math.sin(elapsed * 0.78 + animation.phase) *
        0.018 *
        force;
      windScratch.rotation.makeRotationZ(sway);
      windScratch.rotationX.makeRotationX(
        Math.cos(elapsed * 0.62 + animation.phase * 1.3) * sway * 0.46,
      );
      windScratch.rotation.multiply(windScratch.rotationX);
      windScratch.result
        .copy(animation.rootMatrix)
        .multiply(animation.pivotMatrix)
        .multiply(windScratch.rotation)
        .multiply(animation.inversePivotMatrix)
        .multiply(leaf.localMatrix);
      leaves.current?.setMatrixAt(index, windScratch.result);
    });
    leaves.current.instanceMatrix.needsUpdate = true;
  });

  const selectInstance = (
    event: ThreeEvent<MouseEvent>,
    instances: TreeRenderInstance[],
  ) => {
    event.stopPropagation();
    const instance = instances[event.instanceId ?? 0] ?? instances[0];
    if (instance) onSelectOwner(instance.owner);
  };

  const radialSegments =
    quality === "high" ? 10 : quality === "medium" ? 8 : 6;

  return (
    <group>
      {renderData.branches.length > 0 ? (
        <instancedMesh
          ref={branches}
          args={[undefined, undefined, renderData.branches.length]}
          castShadow={quality !== "low"}
          receiveShadow
          frustumCulled={false}
          onClick={(event) => selectInstance(event, renderData.branches)}
          {...cursorHandlers}
        >
          <cylinderGeometry args={[0.58, 1, 1, radialSegments, 1, false]} />
          <meshStandardMaterial
            map={barkColorMap}
            normalMap={barkNormalMap}
            normalScale={new THREE.Vector2(0.38, 0.38)}
            roughness={0.9}
            roughnessMap={barkRoughnessMap}
          />
        </instancedMesh>
      ) : null}
      {renderData.leaves.length > 0 ? (
        <instancedMesh
          ref={leaves}
          args={[leafGeometry, undefined, renderData.leaves.length]}
          castShadow={quality === "high"}
          frustumCulled={false}
          onClick={(event) => selectInstance(event, renderData.leaves)}
          {...cursorHandlers}
        >
          <meshStandardMaterial
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
            roughness={0.78}
            side={THREE.DoubleSide}
          />
        </instancedMesh>
      ) : null}
      {renderData.snow.length > 0 ? (
        <instancedMesh
          ref={snow}
          args={[undefined, undefined, renderData.snow.length]}
          castShadow={quality === "high"}
          frustumCulled={false}
          onClick={(event) => selectInstance(event, renderData.snow)}
          {...cursorHandlers}
        >
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            flatShading
            roughness={0.8}
          />
        </instancedMesh>
      ) : null}
      {renderData.blossoms.length > 0 ? (
        <instancedMesh
          ref={blossoms}
          args={[undefined, undefined, renderData.blossoms.length]}
          frustumCulled={false}
          onClick={(event) => selectInstance(event, renderData.blossoms)}
          {...cursorHandlers}
        >
          <tetrahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            emissive="#4b2a28"
            emissiveIntensity={0.08}
            flatShading
            roughness={0.76}
          />
        </instancedMesh>
      ) : null}
    </group>
  );
}

function TreeGrove({
  density,
  health,
  palette,
  quality,
  reducedMotion,
  season,
  seed,
  stats,
  timeOfDay,
  weather,
  onSelect,
}: {
  density: number;
  health: number;
  palette: GardenPalette;
  quality: GardenQuality;
  reducedMotion: boolean;
  season: GardenSeason;
  seed: number;
  stats: GardenStats;
  timeOfDay: GardenTimeOfDay;
  weather: GardenWeather;
  onSelect?: (selection: GardenSelection | null) => void;
}) {
  const count = Math.round(
    clamp(1 + Math.sqrt(Math.max(0, stats.pullRequests)) * 0.78, 1, 14) *
      density,
  );
  const trees = useMemo(() => createTrees(count, seed), [count, seed]);
  const structures = useMemo(
    () => trees.map((tree, index) => buildTreeStructure(tree, index, quality)),
    [quality, trees],
  );
  const batchTrees = useMemo<TreeBatchItem[]>(
    () =>
      trees.map((tree, index) => ({
        structure: structures[index],
        position: [tree.x, 0.05, tree.z],
        rotation: tree.rotation,
        scale: treeScaleFor(tree),
        owner: index,
      })),
    [structures, trees],
  );

  const selectTree = (index: number) => {
    const item = trees[index];
    const structure = structures[index];
    if (!item || !structure) return;
    const growthStage =
      item.age > 0.72 ? "Mature" : item.age > 0.36 ? "Growing" : "Young";
    const treeScale = treeScaleFor(item);
    onSelect?.({
      kind: "tree",
      id: `pull-request-tree-${index}`,
      title: `${growthStage} ${TREE_SPECIES_LABEL[structure.species].toLowerCase()}`,
      subtitle: "Pull request grove",
      description:
        "The current pull request total sustains this collaborative perimeter grove.",
      accent: palette.foliage[item.variant % palette.foliage.length],
      worldPosition: [
        item.x,
        0.05 + structure.height * treeScale * 0.62,
        item.z,
      ],
      details: [
        { label: "Pull requests", value: stats.pullRequests },
        { label: "Species", value: TREE_SPECIES_LABEL[structure.species] },
        { label: "Growth stage", value: growthStage },
        { label: "Canopy health", value: `${Math.round(health * 100)}%` },
      ],
      count: stats.pullRequests,
    });
  };

  return (
    <group>
      <ProceduralTreeBatch
        trees={batchTrees}
        health={health}
        palette={palette}
        quality={quality}
        reducedMotion={reducedMotion}
        season={season}
        weather={weather}
        onSelectOwner={selectTree}
      />
      <SpiritTree
        health={health}
        palette={palette}
        quality={quality}
        reducedMotion={reducedMotion}
        season={season}
        stats={stats}
        timeOfDay={timeOfDay}
        weather={weather}
        onSelect={onSelect}
      />
    </group>
  );
}

function SpiritTree({
  health,
  palette,
  quality,
  reducedMotion,
  season,
  stats,
  surfaceSampler,
  timeOfDay,
  weather,
  onSelect,
}: {
  health: number;
  palette: GardenPalette;
  quality: GardenQuality;
  reducedMotion: boolean;
  season: GardenSeason;
  stats: GardenStats;
  surfaceSampler?: PhotorealIslandSurfaceSampler;
  timeOfDay: GardenTimeOfDay;
  weather: GardenWeather;
  onSelect?: (selection: GardenSelection | null) => void;
}) {
  const legendary = stats.streak >= 365;
  const ancient = stats.streak >= 1000;
  const glow = legendary ? (timeOfDay === "night" ? 0.65 : 0.28) : 0.04;
  const heroScale = 1 + health * 0.04 + Math.min(0.28, stats.streak / 3200);
  const rootY = surfaceSampler
    ? (surfaceSampler(2.62, 0.48) ?? 0) + ISLAND_SURFACE_OFFSET
    : 0.15;
  const heroItem = useMemo<TreeItem>(
    () => ({
      x: 0,
      z: 0,
      rotation: -0.24,
      scale: 1,
      variant: 0,
      age: 1,
    }),
    [],
  );
  const structure = useMemo(
    () => buildTreeStructure(heroItem, 1977, quality, true),
    [heroItem, quality],
  );
  const batchTrees = useMemo<TreeBatchItem[]>(
    () => [
      {
        structure,
        position: [2.62, rootY, 0.48],
        rotation: heroItem.rotation,
        scale: heroScale,
        owner: 0,
      },
    ],
    [heroItem.rotation, heroScale, rootY, structure],
  );

  const selectSpiritTree = () => {
    const title = ancient
      ? "Ancient Spirit Tree"
      : legendary
        ? "Legendary streak tree"
        : "Streak tree";
    onSelect?.({
      kind: legendary ? "achievement" : "tree",
      id: "streak-tree",
      title,
      subtitle: "Streak landmark",
      description: legendary
        ? "Extraordinary consistency awakened a permanent light in the garden."
        : "Each uninterrupted contribution day strengthens the oldest tree.",
      accent: legendary ? palette.waterGlow : palette.foliage[2],
      worldPosition: [2.62, rootY + structure.height * heroScale * 0.58, 0.48],
      details: [
        { label: "Longest streak", value: `${stats.streak} days` },
        {
          label: "State",
          value: ancient ? "Ancient" : legendary ? "Legendary" : "Growing",
        },
        {
          label: "Total contributions",
          value: stats.totalContributions.toLocaleString(),
        },
      ],
      count: stats.streak,
    });
  };

  return (
    <group>
      <ProceduralTreeBatch
        trees={batchTrees}
        health={health}
        palette={palette}
        quality={quality}
        reducedMotion={reducedMotion}
        season={season}
        weather={weather}
        emissive={legendary ? palette.waterGlow : "#000000"}
        emissiveIntensity={glow}
        winterFoliage={legendary ? 0.22 : 0}
        onSelectOwner={selectSpiritTree}
      />
      {legendary ? (
        <group position={[2.62, rootY, 0.48]} scale={heroScale}>
          <pointLight
            color={palette.waterGlow}
            distance={6.5}
            intensity={timeOfDay === "night" ? 13 : 5}
            position={[0, 2.6, 0]}
          />
          <SpiritLights color={palette.waterGlow} reducedMotion={reducedMotion} />
        </group>
      ) : null}
    </group>
  );
}

function SpiritLights({ color, reducedMotion }: { color: string; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!group.current || reducedMotion) return;
    group.current.rotation.y = state.clock.elapsedTime * 0.25;
    group.current.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 0.08;
  });

  return (
    <group ref={group} position={[0, 2.6, 0]}>
      {Array.from({ length: 7 }, (_, index) => {
        const angle = (index / 7) * Math.PI * 2;
        const radius = 1.1 + (index % 2) * 0.45;
        return (
          <mesh
            key={index}
            position={[Math.cos(angle) * radius, (index % 3) * 0.34 - 0.2, Math.sin(angle) * radius]}
          >
            <sphereGeometry args={[0.045 + (index % 2) * 0.018, 6, 6]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function Wildlife({
  density,
  health,
  palette,
  reducedMotion,
  season,
  seed,
  stats,
  timeOfDay,
}: {
  density: number;
  health: number;
  palette: GardenPalette;
  reducedMotion: boolean;
  season: GardenSeason;
  seed: number;
  stats: GardenStats;
  timeOfDay: GardenTimeOfDay;
}) {
  const butterflySeason = season === "spring" || season === "summer";
  const butterflies = butterflySeason && health > 0.2
    ? Math.max(
        1,
        Math.round(
          (2 + (stats.streak >= 7 ? 1 : 0) + (stats.streak >= 30 ? 1 : 0)) * density,
        ),
      )
    : 0;
  const birds = health > 0.28 ? Math.max(2, Math.round(4 * density)) : 0;

  return (
    <group>
      {Array.from({ length: butterflies }, (_, index) => (
        <Butterfly
          key={index}
          color={palette.flowers[index % palette.flowers.length]}
          index={index}
          reducedMotion={reducedMotion}
          seed={seed}
        />
      ))}
      {birds > 0 ? (
        <BirdFlock
          count={birds}
          color={timeOfDay === "night" ? "#9fb3c9" : "#334a4b"}
          reducedMotion={reducedMotion}
          seed={seed + 91}
        />
      ) : null}
      {timeOfDay === "night" || timeOfDay === "sunset" ? (
        <Fireflies
          color={season === "winter" ? "#bcecff" : "#eaff8f"}
          count={Math.round((timeOfDay === "night" ? 56 : 24) * density)}
          reducedMotion={reducedMotion}
          seed={seed + 181}
        />
      ) : null}
    </group>
  );
}

function Butterfly({
  color,
  index,
  reducedMotion,
  seed,
}: {
  color: string;
  index: number;
  reducedMotion: boolean;
  seed: number;
}) {
  const group = useRef<THREE.Group>(null);
  const leftWing = useRef<THREE.Mesh>(null);
  const rightWing = useRef<THREE.Mesh>(null);
  const settings = useMemo(() => {
    const random = seededRandom(seed + index * 71);
    return {
      radius: 2.25 + random() * 3.1,
      speed: 0.14 + random() * 0.1,
      offset: random() * Math.PI * 2,
      height: 1 + random() * 1.25,
      direction: random() > 0.5 ? 1 : -1,
    };
  }, [index, seed]);

  useFrame((state) => {
    if (!group.current) return;
    if (reducedMotion) {
      // Deterministic rest pose: parked on its flight path with folded wings
      // instead of an arbitrary frozen mid-flight orientation.
      const angle = settings.offset;
      group.current.position.set(
        Math.cos(angle) * settings.radius,
        settings.height,
        Math.sin(angle * 1.18) * settings.radius * 0.72,
      );
      group.current.rotation.y =
        -angle + (settings.direction > 0 ? 0 : Math.PI);
      if (leftWing.current && rightWing.current) {
        leftWing.current.rotation.y = 0.24;
        rightWing.current.rotation.y = -0.24;
      }
      return;
    }
    const time = state.clock.elapsedTime;
    const angle = time * settings.speed * settings.direction + settings.offset;
    group.current.position.set(
      Math.cos(angle) * settings.radius,
      settings.height + Math.sin(time * 1.8 + index) * 0.25,
      Math.sin(angle * 1.18) * settings.radius * 0.72,
    );
    group.current.rotation.y = -angle + (settings.direction > 0 ? 0 : Math.PI);
    if (leftWing.current && rightWing.current) {
      const flap = 0.24 + Math.abs(Math.sin(time * 8.5 + index)) * 0.86;
      leftWing.current.rotation.y = flap;
      rightWing.current.rotation.y = -flap;
    }
  });

  return (
    <group ref={group}>
      <mesh scale={[0.035, 0.05, 0.15]} rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[1, 1, 3, 5]} />
        <meshStandardMaterial color="#3d302b" roughness={0.8} />
      </mesh>
      <mesh ref={leftWing} position={[-0.02, 0, 0]} rotation={[Math.PI / 2, 0.55, 0]} scale={[1.15, 1, 0.74]}>
        <circleGeometry args={[0.17, 3]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.08}
          side={THREE.DoubleSide}
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh ref={rightWing} position={[0.02, 0, 0]} rotation={[Math.PI / 2, -0.55, 0]} scale={[1.15, 1, 0.74]}>
        <circleGeometry args={[0.17, 3]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.08}
          side={THREE.DoubleSide}
          transparent
          opacity={0.9}
        />
      </mesh>
    </group>
  );
}

function BirdFlock({
  color,
  count,
  reducedMotion,
  seed,
}: {
  color: string;
  count: number;
  reducedMotion: boolean;
  seed: number;
}) {
  const flock = useRef<THREE.Group>(null);
  const settings = useMemo(() => {
    const random = seededRandom(seed);
    return { offset: random() * Math.PI * 2, radius: 8 + random() * 1.7 };
  }, [seed]);

  useFrame((state) => {
    if (!flock.current || reducedMotion) return;
    const angle = state.clock.elapsedTime * 0.075 + settings.offset;
    flock.current.position.set(
      Math.cos(angle) * settings.radius,
      5.5 + Math.sin(angle * 2) * 0.45,
      Math.sin(angle) * settings.radius,
    );
    flock.current.rotation.y = -angle;
  });

  return (
    <group ref={flock} position={[7, 5.5, 2]}>
      {Array.from({ length: count }, (_, index) => (
        <Bird
          key={index}
          color={color}
          index={index}
          position={[-index * 0.62, (index % 2) * 0.18, Math.abs(index - 1) * 0.4]}
          reducedMotion={reducedMotion}
        />
      ))}
    </group>
  );
}

function Bird({
  color,
  index,
  position,
  reducedMotion,
}: {
  color: string;
  index: number;
  position: VectorTuple;
  reducedMotion: boolean;
}) {
  const leftWing = useRef<THREE.Mesh>(null);
  const rightWing = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (reducedMotion || !leftWing.current || !rightWing.current) return;
    const wing = Math.sin(state.clock.elapsedTime * 4.2 + index * 0.8) * 0.45;
    leftWing.current.rotation.z = -0.2 + wing;
    rightWing.current.rotation.z = 0.2 - wing;
  });

  return (
    <group position={position} scale={0.72}>
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.07, 0.08, 0.28]}>
        <coneGeometry args={[1, 1, 5]} />
        <meshBasicMaterial color={color} fog />
      </mesh>
      <mesh ref={leftWing} position={[-0.14, 0, 0]} rotation={[-Math.PI / 2, 0, -0.2]} scale={[0.28, 0.14, 0.04]}>
        <coneGeometry args={[1, 1, 3]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={rightWing} position={[0.14, 0, 0]} rotation={[-Math.PI / 2, 0, 0.2]} scale={[0.28, 0.14, 0.04]}>
        <coneGeometry args={[1, 1, 3]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Fireflies({
  color,
  count,
  reducedMotion,
  seed,
}: {
  color: string;
  count: number;
  reducedMotion: boolean;
  seed: number;
}) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const random = seededRandom(seed);
    const values = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * 6.6;
      values[index * 3] = Math.cos(angle) * radius;
      values[index * 3 + 1] = 0.42 + random() * 2.1;
      values[index * 3 + 2] = Math.sin(angle) * radius;
    }
    return values;
  }, [count, seed]);

  useFrame((state) => {
    if (!points.current) return;
    const material = points.current.material as THREE.PointsMaterial;
    material.opacity = 0.52 + Math.sin(state.clock.elapsedTime * 2.1) * 0.22;
    if (reducedMotion) return;
    const attribute = points.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    const values = attribute.array as Float32Array;
    for (let index = 0; index < count; index += 1) {
      values[index * 3 + 1] += Math.sin(state.clock.elapsedTime + index * 1.73) * 0.0008;
      values[index * 3] += Math.cos(state.clock.elapsedTime * 0.4 + index) * 0.00045;
    }
    attribute.needsUpdate = true;
  });

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        depthWrite={false}
        opacity={0.72}
        size={0.105}
        sizeAttenuation
        transparent
        toneMapped={false}
      />
    </points>
  );
}

function WeatherSystem({
  density,
  palette,
  quality,
  reducedMotion,
  seed,
  season,
  timeOfDay,
  weather,
}: {
  density: number;
  palette: GardenPalette;
  quality: GardenQuality;
  reducedMotion: boolean;
  seed: number;
  season: GardenSeason;
  timeOfDay: GardenTimeOfDay;
  weather: GardenWeather;
}) {
  return (
    <group>
      {timeOfDay === "night" ? <StarField count={Math.round(240 * density)} seed={seed + 1} /> : null}
      {weather === "rain" ? (
        <WeatherParticles
          color="#b8dce2"
          count={Math.round(520 * density)}
          mode="rain"
          reducedMotion={reducedMotion}
          seed={seed + 2}
        />
      ) : null}
      {weather === "snow" ? (
        <WeatherParticles
          color="#f3fbff"
          count={Math.round(310 * density)}
          mode="snow"
          reducedMotion={reducedMotion}
          seed={seed + 3}
        />
      ) : null}
      {weather === "wind" ? (
        <WeatherParticles
          color={season === "autumn" ? palette.flowers[1] : palette.mote}
          count={Math.round(95 * density)}
          mode="wind"
          reducedMotion={reducedMotion}
          seed={seed + 4}
        />
      ) : null}
      {season === "autumn" && (weather === "sunny" || weather === "wind") ? (
        <WeatherParticles
          color={palette.flowers[0]}
          count={Math.round(65 * density)}
          mode="leaves"
          reducedMotion={reducedMotion}
          seed={seed + 5}
        />
      ) : null}
      {quality === "low" && weather === "sunny" && timeOfDay !== "night" ? (
        <AmbientMotes color={palette.mote} count={Math.round(95 * density)} seed={seed + 6} reducedMotion={reducedMotion} />
      ) : null}
    </group>
  );
}

type WeatherParticleMode = "rain" | "snow" | "wind" | "leaves";

function WeatherParticles({
  color,
  count,
  mode,
  reducedMotion,
  seed,
}: {
  color: string;
  count: number;
  mode: WeatherParticleMode;
  reducedMotion: boolean;
  seed: number;
}) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const random = seededRandom(seed);
    const values = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      values[index * 3] = (random() - 0.5) * 20;
      values[index * 3 + 1] = 0.2 + random() * 12;
      values[index * 3 + 2] = (random() - 0.5) * 20;
    }
    return values;
  }, [count, seed]);

  useFrame((state, delta) => {
    if (!points.current || reducedMotion) return;
    const attribute = points.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    const values = attribute.array as Float32Array;
    const time = state.clock.elapsedTime;

    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      if (mode === "rain") {
        values[offset] += delta * 0.75;
        values[offset + 1] -= delta * (8.5 + (index % 7) * 0.48);
        if (values[offset + 1] < -0.25) values[offset + 1] = 11.5;
      } else if (mode === "snow") {
        values[offset] += Math.sin(time * 0.5 + index) * delta * 0.25;
        values[offset + 1] -= delta * (0.44 + (index % 5) * 0.07);
        values[offset + 2] += Math.cos(time * 0.35 + index * 0.9) * delta * 0.18;
        if (values[offset + 1] < -0.2) values[offset + 1] = 11;
      } else if (mode === "wind") {
        values[offset] += delta * (2.5 + (index % 5) * 0.35);
        values[offset + 1] += Math.sin(time * 2 + index) * delta * 0.35;
        if (values[offset] > 10) values[offset] = -10;
      } else {
        values[offset] += Math.sin(time + index) * delta * 0.42;
        values[offset + 1] -= delta * (0.34 + (index % 4) * 0.06);
        values[offset + 2] += Math.cos(time * 0.6 + index) * delta * 0.25;
        if (values[offset + 1] < 0) values[offset + 1] = 9 + (index % 4);
      }
    }
    attribute.needsUpdate = true;
  });

  const size = mode === "rain" ? 0.055 : mode === "snow" ? 0.14 : mode === "leaves" ? 0.11 : 0.075;
  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        depthWrite={false}
        opacity={mode === "rain" ? 0.48 : 0.72}
        size={size}
        sizeAttenuation
        transparent
        toneMapped={mode === "snow" ? false : undefined}
      />
    </points>
  );
}

function AmbientMotes({
  color,
  count,
  reducedMotion,
  seed,
}: {
  color: string;
  count: number;
  reducedMotion: boolean;
  seed: number;
}) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const random = seededRandom(seed);
    const values = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * 7.5;
      values[index * 3] = Math.cos(angle) * radius;
      values[index * 3 + 1] = 0.35 + random() * 4.3;
      values[index * 3 + 2] = Math.sin(angle) * radius;
    }
    return values;
  }, [count, seed]);

  useFrame((state) => {
    if (!points.current || reducedMotion) return;
    points.current.rotation.y = state.clock.elapsedTime * 0.018;
    points.current.position.y = Math.sin(state.clock.elapsedTime * 0.31) * 0.05;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        depthWrite={false}
        opacity={0.46}
        size={0.045}
        sizeAttenuation
        transparent
      />
    </points>
  );
}

function StarField({ count, seed }: { count: number; seed: number }) {
  const positions = useMemo(() => {
    const random = seededRandom(seed);
    const values = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 24 + random() * 11;
      const height = 8 + random() * 16;
      values[index * 3] = Math.cos(angle) * radius;
      values[index * 3 + 1] = height;
      values[index * 3 + 2] = Math.sin(angle) * radius;
    }
    return values;
  }, [count, seed]);

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#e8f4ff"
        depthWrite={false}
        fog={false}
        opacity={0.8}
        size={0.13}
        sizeAttenuation
        transparent
        toneMapped={false}
      />
    </points>
  );
}

function GardenWalkthroughControls({
  input,
  onExit,
  surfaceSampler,
}: {
  input: GardenWalkInput;
  onExit?: () => void;
  surfaceSampler: PhotorealIslandSurfaceSampler;
}) {
  const getThreeState = useThree((state) => state.get);
  const inputRef = useRef(input);
  const onExitRef = useRef(onExit);
  const keyState = useRef<GardenWalkInput>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
  });
  const yaw = useRef(0);
  const pitch = useRef(-0.06);
  const savedCamera = useRef<{
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    fov: number | null;
    zoom: number | null;
  } | null>(null);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const movement = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useLayoutEffect(() => {
    const { camera, gl } = getThreeState();
    const canvas = gl.domElement;
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const previousCursor = canvas.style.cursor;
    const previousTabIndex = canvas.getAttribute("tabindex");
    const previouslyFocused = document.activeElement;
    savedCamera.current = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      fov: perspectiveCamera.isPerspectiveCamera ? perspectiveCamera.fov : null,
      zoom: perspectiveCamera.isPerspectiveCamera ? perspectiveCamera.zoom : null,
    };

    const eyeHeight = 1.62;
    const startGround =
      (surfaceSampler(-6, -0.86) ?? 0) + ISLAND_SURFACE_OFFSET;
    const targetGround =
      (surfaceSampler(0.1, 0.86) ?? 0) + ISLAND_SURFACE_OFFSET;
    const start = new THREE.Vector3(-6, startGround + eyeHeight, -0.86);
    const target = new THREE.Vector3(0.1, targetGround + 1.02, 0.86);
    const direction = target.clone().sub(start).normalize();
    yaw.current = Math.atan2(-direction.x, -direction.z);
    pitch.current = Math.asin(direction.y);
    camera.position.copy(start);
    camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");
    if (perspectiveCamera.isPerspectiveCamera) {
      perspectiveCamera.fov = 58;
      perspectiveCamera.zoom = 1;
      perspectiveCamera.updateProjectionMatrix();
    }
    canvas.setAttribute("tabindex", "0");
    canvas.focus({ preventScroll: true });
    canvas.style.setProperty("cursor", "grab");

    const setKey = (code: string, pressed: boolean) => {
      switch (code) {
        case "KeyW":
        case "ArrowUp":
          keyState.current.forward = pressed;
          return true;
        case "KeyS":
        case "ArrowDown":
          keyState.current.backward = pressed;
          return true;
        case "KeyA":
        case "ArrowLeft":
          keyState.current.left = pressed;
          return true;
        case "KeyD":
        case "ArrowRight":
          keyState.current.right = pressed;
          return true;
        case "ShiftLeft":
        case "ShiftRight":
          keyState.current.sprint = pressed;
          return true;
        default:
          return false;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        event.preventDefault();
        onExitRef.current?.();
        return;
      }
      const targetElement = event.target;
      if (
        targetElement instanceof HTMLElement &&
        (targetElement.matches("input, textarea, select, button") ||
          targetElement.isContentEditable)
      ) {
        return;
      }
      if (setKey(event.code, true)) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (setKey(event.code, false)) event.preventDefault();
    };
    const resetKeys = () => {
      keyState.current = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        sprint: false,
      };
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") resetKeys();
    };

    let dragging = false;
    let activePointer = -1;
    let previousX = 0;
    let previousY = 0;
    let dragDistance = 0;
    let suppressingClick = false;

    const swallowClick = (event: MouseEvent) => {
      suppressingClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const stopDragging = (event?: PointerEvent) => {
      if (event && activePointer !== event.pointerId) return;
      const shouldSuppressClick =
        event?.type === "pointerup" && dragDistance >= 6;
      dragging = false;
      if (
        event &&
        canvas.hasPointerCapture(event.pointerId)
      ) {
        canvas.releasePointerCapture(event.pointerId);
      }
      activePointer = -1;
      canvas.style.setProperty("cursor", "grab");
      if (shouldSuppressClick && !suppressingClick) {
        suppressingClick = true;
        canvas.addEventListener("click", swallowClick, {
          capture: true,
          once: true,
        });
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || dragging) return;
      event.preventDefault();
      dragging = true;
      activePointer = event.pointerId;
      previousX = event.clientX;
      previousY = event.clientY;
      dragDistance = 0;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.setProperty("cursor", "grabbing");
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== activePointer) return;
      const deltaX = event.clientX - previousX;
      const deltaY = event.clientY - previousY;
      previousX = event.clientX;
      previousY = event.clientY;
      dragDistance += Math.hypot(deltaX, deltaY);
      const sensitivity = event.pointerType === "touch" ? 0.006 : 0.00235;
      yaw.current -= deltaX * sensitivity;
      pitch.current = clamp(
        pitch.current - deltaY * sensitivity,
        -Math.PI * (5 / 12),
        Math.PI * (5 / 12),
      );
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: false });
    window.addEventListener("blur", resetKeys);
    document.addEventListener("visibilitychange", onVisibilityChange);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", stopDragging);
    canvas.addEventListener("pointercancel", stopDragging);
    canvas.addEventListener("lostpointercapture", stopDragging);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", resetKeys);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", stopDragging);
      canvas.removeEventListener("pointercancel", stopDragging);
      canvas.removeEventListener("lostpointercapture", stopDragging);
      if (suppressingClick) {
        canvas.removeEventListener("click", swallowClick, true);
      }
      if (
        activePointer >= 0 &&
        canvas.hasPointerCapture(activePointer)
      ) {
        canvas.releasePointerCapture(activePointer);
      }
      resetKeys();
      canvas.style.setProperty("cursor", previousCursor);
      if (previousTabIndex === null) {
        canvas.removeAttribute("tabindex");
      } else {
        canvas.setAttribute("tabindex", previousTabIndex);
      }

      const saved = savedCamera.current;
      if (saved) {
        camera.position.copy(saved.position);
        camera.quaternion.copy(saved.quaternion);
        if (perspectiveCamera.isPerspectiveCamera && saved.fov !== null) {
          perspectiveCamera.fov = saved.fov;
          if (saved.zoom !== null) perspectiveCamera.zoom = saved.zoom;
          perspectiveCamera.updateProjectionMatrix();
        }
      }
      savedCamera.current = null;
      window.requestAnimationFrame(() => {
        if (
          previouslyFocused instanceof HTMLElement &&
          previouslyFocused.isConnected
        ) {
          previouslyFocused.focus({ preventScroll: true });
        }
      });
    };
  }, [getThreeState, surfaceSampler]);

  useFrame((state, delta) => {
    const camera = state.camera;
    const keyboard = keyState.current;
    const touch = inputRef.current;
    const forwardAmount =
      Number(keyboard.forward || touch.forward) -
      Number(keyboard.backward || touch.backward);
    const rightAmount =
      Number(keyboard.right || touch.right) -
      Number(keyboard.left || touch.left);
    const moving = forwardAmount !== 0 || rightAmount !== 0;

    camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");
    if (moving) {
      forward.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
      right.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
      movement
        .set(0, 0, 0)
        .addScaledVector(forward, forwardAmount)
        .addScaledVector(right, rightAmount)
        .normalize();

      const sprinting = Boolean(keyboard.sprint || touch.sprint);
      const speed = sprinting ? 3.35 : 1.9;
      const distance = speed * Math.min(delta, 0.05);
      const currentGround =
        (surfaceSampler(camera.position.x, camera.position.z) ?? 0) +
        ISLAND_SURFACE_OFFSET;
      const isWalkable = (x: number, z: number) => {
        const sampledHeight = surfaceSampler(x, z);
        return (
          sampledHeight !== null &&
          Math.hypot(x, z) <= WORLD_RADIUS - 0.72 &&
          isOutsidePond(x, z, 1.28) &&
          Math.hypot(x - 2.62, z - 0.48) > 1.24 &&
          Math.abs(sampledHeight + ISLAND_SURFACE_OFFSET - currentGround) < 0.46
        );
      };

      const nextX = camera.position.x + movement.x * distance;
      let resolvedX = camera.position.x;
      if (isWalkable(nextX, camera.position.z)) {
        resolvedX = nextX;
      }
      const nextZ = camera.position.z + movement.z * distance;
      let resolvedZ = camera.position.z;
      if (isWalkable(resolvedX, nextZ)) {
        resolvedZ = nextZ;
      }
      camera.position.x = resolvedX;
      camera.position.z = resolvedZ;
    }
    const terrainHeight =
      (surfaceSampler(camera.position.x, camera.position.z) ?? 0) +
      ISLAND_SURFACE_OFFSET;
    camera.position.y = THREE.MathUtils.damp(
      camera.position.y,
      terrainHeight + 1.62,
      13,
      Math.min(delta, 0.05),
    );
  });

  return null;
}

function CameraFlythrough({
  reducedMotion,
  onComplete,
}: {
  reducedMotion: boolean;
  onComplete?: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const elapsed = useRef(0);
  const completed = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const path = useMemo(
    () =>
      new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(14.8, 12.8, 17.2),
          new THREE.Vector3(7.6, 8.5, 14.2),
          new THREE.Vector3(-7.2, 7.4, 12.8),
          new THREE.Vector3(-14.3, 7.8, -2.8),
          new THREE.Vector3(-5.3, 7.2, -13.6),
          new THREE.Vector3(9.8, 8, -10.8),
          new THREE.Vector3(14.8, 12.8, 17.2),
        ],
        false,
        "catmullrom",
        0.42,
      ),
    [],
  );
  const position = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    elapsed.current = 0;
    completed.current = false;
    if (reducedMotion) {
      completed.current = true;
      onCompleteRef.current?.();
    }
  }, [reducedMotion]);

  useFrame((state, delta) => {
    if (reducedMotion || completed.current) return;
    elapsed.current += delta;
    const progress = clamp01(elapsed.current / 16);
    const eased = progress * progress * (3 - 2 * progress);
    path.getPointAt(eased, position);
    camera.position.lerp(position, 1 - Math.exp(-delta * 5.5));
    target.set(
      Math.sin(eased * Math.PI * 2) * 1.3,
      1 + Math.sin(eased * Math.PI) * 0.58,
      Math.cos(eased * Math.PI * 2) * 0.85,
    );
    camera.lookAt(target);

    if (progress >= 1) {
      completed.current = true;
      path.getPointAt(1, position);
      camera.position.copy(position);
      camera.lookAt(target);
      onCompleteRef.current?.();
    }
  });

  return null;
}
