import { bladesForDay, distanceToPath, PATH_INTERCEPT, PATH_SLOPE, type GardenLayout } from "./mapping";
import { MEADOW_BED_LENGTH, MEADOW_BED_START, seededRandom } from "./meadow-layout";

/**
 * Pure placement for the garden's flora: stepping stones along the path,
 * wildflower clusters, shrubs and mossy rocks. Everything keeps off the path,
 * the pond, the waterfall channel and the trees, and wildflowers prefer the
 * gaps between the meadow's year rings to the thick beds on them.
 */

export interface FloraCircle {
  x: number;
  z: number;
  radius: number;
}

export interface PathStone {
  x: number;
  z: number;
  /** Yaw: the stone's local x axis runs along the path. */
  rotation: number;
  /** Half extent along the path. */
  length: number;
  /** Half extent across the path. */
  width: number;
  /** 0..1, stable per stone (colour and thickness variation). */
  tint: number;
}

/** 0 = spike (lupine), 1..3 = round heads. Indexes `palette.flowers`. */
export type FlowerVariant = 0 | 1 | 2 | 3;

export interface Wildflower {
  x: number;
  z: number;
  variant: FlowerVariant;
  /** Stem height in world units. */
  height: number;
  /** Head radius (round heads) or spike width (lupines). */
  head: number;
  rotation: number;
  /** 0..1, stable per flower (colour jitter). */
  tint: number;
  cluster: number;
}

export interface ShrubBlob {
  dx: number;
  dy: number;
  dz: number;
  radius: number;
}

export interface Shrub {
  x: number;
  z: number;
  rotation: number;
  /** Index into the foliage palette for the shrub's base colour. */
  colour: number;
  tint: number;
  blobs: ShrubBlob[];
  /** Footprint radius, for keeping other things clear. */
  radius: number;
}

export interface Rock {
  x: number;
  z: number;
  rotation: number;
  /** Tilt about x and z, in radians. */
  tiltX: number;
  tiltZ: number;
  /** Horizontal radius. */
  size: number;
  /** Height / width. */
  squash: number;
  /** Width / depth. */
  stretch: number;
  tint: number;
}

export interface FloraLayout {
  stones: PathStone[];
  flowers: Wildflower[];
  shrubs: Shrub[];
  rocks: Rock[];
}

/**
 * Where the meadow's year rings run and how thick each stretch is. Built from
 * the whole calendar (not the playback cut-off), so flowers keep still while
 * the timeline plays.
 */
export interface MeadowBeds {
  ringRadii: number[];
  /** Blades per ring per angular bucket. */
  occupancy: number[][];
}

export type FloraLayoutSource = Pick<
  GardenLayout,
  "islandRadius" | "pond" | "flowerCount" | "shrubCount" | "rockCount"
> & {
  yearTrees: ReadonlyArray<{ x: number; z: number }>;
  greatTree: { x: number; z: number; scale: number };
};

export interface FloraLayoutInput {
  layout: FloraLayoutSource;
  /** Circles along the waterfall's outflow channel. */
  channel: ReadonlyArray<FloraCircle>;
  /** True where the island has a ground surface. */
  onIsland: (x: number, z: number) => boolean;
  meadow: MeadowBeds | null;
  seed: number;
}

const TAU = Math.PI * 2;
const MEADOW_BUCKETS = 36;
/** Blades in one bucket of a ring (about ten days) that make it a thick bed. */
const THICK_BED = 6;
/** How far either side of a ring its tufts reach. */
const RING_HALF_WIDTH = 0.24;
const POND_SEMI_X = 1.96;
const POND_SEMI_Z = 1.2;
export const STONE_SPACING = 0.95;
export const PATH_CLEARANCE = 0.6;
export const POND_CLEARANCE = 0.4;
export const TREE_CLEARANCE = 0.9;
export const GREAT_TREE_CLEARANCE = 1.2;
const FLOWER_MIN_RADIUS = 2.4;
/** Ground that must exist beyond a flower toward the rim. */
const RIM_MARGIN = 0.6;

const PATH_NORM = Math.hypot(1, PATH_SLOPE);
const PATH_DIR = { x: 1 / PATH_NORM, z: PATH_SLOPE / PATH_NORM };
const PATH_PERP = { x: -PATH_SLOPE / PATH_NORM, z: 1 / PATH_NORM };

export function createMeadowBeds(days: ReadonlyArray<{ date: string; count: number }>): MeadowBeds | null {
  if (days.length === 0) return null;
  // The same ring geometry as `createMeadowLayout`.
  const years = Array.from(new Set(days.map((day) => Number(day.date.slice(0, 4))))).sort(
    (a, b) => a - b,
  );
  const slots = new Map(years.map((year, index) => [year, index]));
  const spacing = years.length <= 1 ? 0 : Math.min(0.62, 3.55 / (years.length - 1));
  const ringRadii = years.map((_, index) => 3.12 + index * spacing);
  const occupancy = years.map(() => new Array<number>(MEADOW_BUCKETS).fill(0));
  for (const day of days) {
    if (day.count <= 0) continue;
    const year = Number(day.date.slice(0, 4));
    const slot = slots.get(year) ?? 0;
    const start = Date.UTC(year, 0, 1);
    const dayOfYear = Math.max(0, Math.round((Date.parse(`${day.date}T00:00:00Z`) - start) / 86_400_000));
    const bucket = Math.min(MEADOW_BUCKETS - 1, Math.floor((dayOfYear / 366) * MEADOW_BUCKETS));
    occupancy[slot][bucket] += bladesForDay(day.count, 1);
  }
  return { ringRadii, occupancy };
}

/** True on a stretch of year ring thick with grass tufts. */
export function onThickMeadow(beds: MeadowBeds | null, x: number, z: number) {
  if (!beds) return false;
  let angle = Math.atan2(z, x) - MEADOW_BED_START;
  angle = ((angle % TAU) + TAU) % TAU;
  if (angle > MEADOW_BED_LENGTH + 0.05) return false;
  const bucket = Math.min(
    MEADOW_BUCKETS - 1,
    Math.max(0, Math.floor((angle / MEADOW_BED_LENGTH) * MEADOW_BUCKETS)),
  );
  const radius = Math.hypot(x, z);
  return beds.ringRadii.some(
    (ring, slot) =>
      Math.abs(radius - ring) < RING_HALF_WIDTH && beds.occupancy[slot][bucket] >= THICK_BED,
  );
}

export function insidePond(
  pond: { x: number; z: number; scale: number },
  x: number,
  z: number,
  padding: number,
) {
  const semiX = POND_SEMI_X * pond.scale + padding;
  const semiZ = POND_SEMI_Z * pond.scale + padding;
  const dx = (x - pond.x) / semiX;
  const dz = (z - pond.z) / semiZ;
  return dx * dx + dz * dz < 1;
}

export function greatTreeClearance(scale: number) {
  return Math.max(GREAT_TREE_CLEARANCE, 0.75 * scale);
}

/** Shared rejection: path, pond, waterfall channel, trees, rim, and placed items. */
function createBlocker(input: FloraLayoutInput) {
  const { layout, channel, onIsland } = input;
  const great = layout.greatTree;
  const greatClear = greatTreeClearance(great.scale);
  return (x: number, z: number, footprint: number, placed: ReadonlyArray<FloraCircle>) => {
    if (distanceToPath(x, z) < PATH_CLEARANCE + footprint) return true;
    if (insidePond(layout.pond, x, z, POND_CLEARANCE + footprint)) return true;
    if (channel.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius + footprint)) return true;
    if (Math.hypot(x - great.x, z - great.z) < greatClear + footprint) return true;
    if (layout.yearTrees.some((t) => Math.hypot(x - t.x, z - t.z) < TREE_CLEARANCE + footprint)) {
      return true;
    }
    const r = Math.hypot(x, z) || 1;
    const margin = RIM_MARGIN + footprint;
    if (!onIsland(x + (x / r) * margin, z + (z / r) * margin)) return true;
    return placed.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius + footprint);
  };
}

export function createPathStones(
  islandRadius: number,
  onIsland: (x: number, z: number) => boolean,
  seed: number,
): PathStone[] {
  const random = seededRandom(seed);
  const reach = islandRadius - 1.5;
  const dx = STONE_SPACING / PATH_NORM;
  const count = Math.floor((2 * reach) / dx) + 1;
  const start = -((count - 1) * dx) / 2;
  const yaw = Math.atan2(-PATH_DIR.z, PATH_DIR.x);
  const phase = random() * TAU;
  const stones: PathStone[] = [];
  for (let index = 0; index < count; index += 1) {
    const along = (random() - 0.5) * 0.1;
    const x0 = start + index * dx + along * PATH_DIR.x;
    const wobble = Math.sin(index * 0.55 + phase) * 0.12 + (random() - 0.5) * 0.06;
    const x = x0 + PATH_PERP.x * wobble;
    const z = PATH_SLOPE * x0 + PATH_INTERCEPT + along * PATH_DIR.z + PATH_PERP.z * wobble;
    const length = 0.3 + random() * 0.08;
    const width = 0.36 + random() * 0.1;
    const rotation = yaw + (random() - 0.5) * 0.45 + (random() < 0.5 ? 0 : Math.PI);
    const tint = random();
    // Keep the whole stone on solid ground, clear of the rim.
    const r = Math.hypot(x, z) || 1;
    if (!onIsland(x + (x / r) * 0.9, z + (z / r) * 0.9)) continue;
    stones.push({ x, z, rotation, length, width, tint });
  }
  return stones;
}

function pickVariant(random: () => number): FlowerVariant {
  const roll = random();
  if (roll < 0.3) return 0; // lupine spikes
  if (roll < 0.5) return 1;
  if (roll < 0.8) return 2;
  return 3;
}

function createRocks(
  input: FloraLayoutInput,
  random: () => number,
  blocked: ReturnType<typeof createBlocker>,
  placed: FloraCircle[],
): Rock[] {
  const { layout } = input;
  const R = layout.islandRadius;
  const rocks: Rock[] = [];
  const target = layout.rockCount;
  let attempts = 0;
  while (rocks.length < target && attempts < target * 60) {
    attempts += 1;
    // Roughly two in five sit at the pond's edge; the rest toward the rim.
    const byPond = rocks.length % 5 === 1 || rocks.length % 5 === 3;
    const size = (byPond ? 0.3 : 0.38) + random() * random() * (byPond ? 0.35 : 0.6);
    let x: number;
    let z: number;
    if (byPond) {
      const angle = random() * TAU;
      const pond = layout.pond;
      const reachX = POND_SEMI_X * pond.scale + POND_CLEARANCE + size + 0.05 + random() * 0.4;
      const reachZ = POND_SEMI_Z * pond.scale + POND_CLEARANCE + size + 0.05 + random() * 0.4;
      x = pond.x + Math.cos(angle) * reachX;
      z = pond.z + Math.sin(angle) * reachZ;
    } else {
      const angle = random() * TAU;
      const radius = R * (0.7 + random() * 0.22);
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
    }
    if (blocked(x, z, size * 0.8, placed)) continue;
    rocks.push({
      x,
      z,
      rotation: random() * TAU,
      tiltX: (random() - 0.5) * 0.3,
      tiltZ: (random() - 0.5) * 0.3,
      size,
      squash: 0.7 + random() * 0.3,
      stretch: 0.8 + random() * 0.4,
      tint: random(),
    });
    placed.push({ x, z, radius: size + 0.1 });
  }
  return rocks;
}

function createShrubs(
  input: FloraLayoutInput,
  random: () => number,
  blocked: ReturnType<typeof createBlocker>,
  placed: FloraCircle[],
): Shrub[] {
  const { layout } = input;
  const R = layout.islandRadius;
  const anchors = [
    ...layout.yearTrees.map((t) => ({ x: t.x, z: t.z, clear: TREE_CLEARANCE })),
    {
      x: layout.greatTree.x,
      z: layout.greatTree.z,
      clear: greatTreeClearance(layout.greatTree.scale),
    },
  ];
  const shrubs: Shrub[] = [];
  const target = layout.shrubCount;
  let attempts = 0;
  while (shrubs.length < target && attempts < target * 60) {
    attempts += 1;
    const size = 0.42 + random() * 0.3;
    let x: number;
    let z: number;
    // Alternate: at a tree's foot, then out toward the rim.
    if (shrubs.length % 2 === 0) {
      const anchor = anchors[Math.floor(random() * anchors.length)];
      const angle = random() * TAU;
      const distance = anchor.clear + size + 0.05 + random() * 0.5;
      x = anchor.x + Math.cos(angle) * distance;
      z = anchor.z + Math.sin(angle) * distance;
    } else {
      const angle = random() * TAU;
      const radius = R * (0.72 + random() * 0.2);
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
    }
    if (blocked(x, z, size * 0.75, placed)) continue;
    const blobCount = 2 + (random() < 0.5 ? 1 : 0);
    const blobs: ShrubBlob[] = [{ dx: 0, dy: size * 0.55, dz: 0, radius: size }];
    for (let k = 1; k < blobCount; k += 1) {
      const angle = random() * TAU;
      const radius = size * (0.6 + random() * 0.2);
      const offset = size * (0.55 + random() * 0.2);
      blobs.push({
        dx: Math.cos(angle) * offset,
        dy: radius * 0.5,
        dz: Math.sin(angle) * offset,
        radius,
      });
    }
    shrubs.push({
      x,
      z,
      rotation: random() * TAU,
      colour: Math.floor(random() * 3),
      tint: random(),
      blobs,
      radius: size * 1.35,
    });
    placed.push({ x, z, radius: size * 1.35 });
  }
  return shrubs;
}

function createFlowers(
  input: FloraLayoutInput,
  random: () => number,
  blocked: ReturnType<typeof createBlocker>,
  placed: ReadonlyArray<FloraCircle>,
): Wildflower[] {
  const { layout, meadow } = input;
  const target = layout.flowerCount;
  const flowers: Wildflower[] = [];
  const minRadius = FLOWER_MIN_RADIUS;
  const maxRadius = Math.max(minRadius + 0.5, layout.islandRadius - 1);
  let cluster = 0;
  let attempts = 0;
  const maxAttempts = target * 40 + 40;
  while (flowers.length < target && attempts < maxAttempts) {
    attempts += 1;
    // Prefer the gaps between year rings; relax once most tries are spent.
    const strict = attempts < maxAttempts * 0.7;
    const angle = random() * TAU;
    const radius = Math.sqrt(
      minRadius * minRadius + random() * (maxRadius * maxRadius - minRadius * minRadius),
    );
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    if (blocked(cx, cz, 0, placed)) continue;
    if (strict && onThickMeadow(meadow, cx, cz)) continue;

    const size = Math.min(target - flowers.length, 3 + Math.floor(random() * 5));
    const dominant = pickVariant(random);
    const spread = 0.24 + size * 0.05;
    let added = 0;
    for (let k = 0; k < size * 4 && added < size; k += 1) {
      const a = random() * TAU;
      const d = k === 0 ? 0 : Math.sqrt(random()) * spread;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (Math.hypot(x, z) < minRadius || Math.hypot(x, z) > maxRadius) continue;
      if (blocked(x, z, 0, placed)) continue;
      if (strict && onThickMeadow(meadow, x, z)) continue;
      if (flowers.some((f) => Math.hypot(f.x - x, f.z - z) < 0.11)) continue;
      const variant = random() < 0.75 ? dominant : pickVariant(random);
      const spike = variant === 0;
      flowers.push({
        x,
        z,
        variant,
        height: spike ? 0.75 + random() * 0.35 : 0.38 + random() * 0.24,
        head: spike ? 0.085 + random() * 0.02 : 0.15 + random() * 0.06,
        rotation: random() * TAU,
        tint: random(),
        cluster,
      });
      added += 1;
    }
    if (added > 0) cluster += 1;
  }
  return flowers;
}

export function createFloraLayout(input: FloraLayoutInput): FloraLayout {
  const blocked = createBlocker(input);
  const placed: FloraCircle[] = [];
  const stones = createPathStones(input.layout.islandRadius, input.onIsland, input.seed + 7);
  const rocks = createRocks(input, seededRandom(input.seed + 31), blocked, placed);
  const shrubs = createShrubs(input, seededRandom(input.seed + 59), blocked, placed);
  const flowers = createFlowers(input, seededRandom(input.seed + 97), blocked, placed);
  return { stones, flowers, shrubs, rocks };
}

/**
 * The centre of each wildflower cluster and how far its flowers reach, in
 * cluster order. Butterflies wander between these.
 */
export function flowerClusters(flowers: ReadonlyArray<Wildflower>): FloraCircle[] {
  const sums: { x: number; z: number; n: number }[] = [];
  for (const flower of flowers) {
    const sum = (sums[flower.cluster] ??= { x: 0, z: 0, n: 0 });
    sum.x += flower.x;
    sum.z += flower.z;
    sum.n += 1;
  }
  const clusters: FloraCircle[] = [];
  sums.forEach((sum, index) => {
    if (!sum || sum.n === 0) return;
    const x = sum.x / sum.n;
    const z = sum.z / sum.n;
    let radius = 0;
    for (const flower of flowers) {
      if (flower.cluster !== index) continue;
      radius = Math.max(radius, Math.hypot(flower.x - x, flower.z - z));
    }
    clusters.push({ x, z, radius });
  });
  return clusters;
}
