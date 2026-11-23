import type { GardenSeason } from "../types";

export interface MappingInput {
  days: ReadonlyArray<{ date: string; count: number }>;
  /** ISO date (YYYY-MM-DD). Days after it are ignored. Undefined means all. */
  visibleThrough?: string;
  stats: { pullRequests: number; issues: number; repositories: number; streak: number };
  /** 0..1 recent-activity health. */
  activity: number;
  season: GardenSeason;
  seed: number;
  /** Tier density multiplier: low 0.5, medium 0.8, high 1. */
  density: number;
  /**
   * Circles year trees must keep clear of (for example the waterfall
   * channel). A tree is nudged when it is within `radius + 0.6` of one.
   */
  obstacles?: ReadonlyArray<{ x: number; z: number; radius: number }>;
}

export interface YearTreeLayout {
  year: number;
  total: number;
  activeDays: number;
  /** 0-11 */
  busiestMonth: number;
  scale: number;
  x: number;
  z: number;
  rotation: number;
  evergreen: boolean;
}

export interface GardenLayout {
  islandRadius: number;
  spanYears: number;
  lifetime: number;
  treeRingRadius: number;
  yearTrees: YearTreeLayout[];
  greatTree: { x: number; z: number; scale: number; glowing: boolean };
  pond: { x: number; z: number; scale: number };
  flowerCount: number;
  butterflyCount: number;
  birdCount: number;
  fireflyCount: number;
  shrubCount: number;
  rockCount: number;
}

export const GREAT_TREE_POSITION = { x: 2.62, z: 0.48 } as const;
export const POND_POSITION = { x: -2.35, z: 1.25 } as const;
/** The path is the line z = PATH_SLOPE * x + PATH_INTERCEPT. */
export const PATH_SLOPE = -0.24;
export const PATH_INTERCEPT = -2.3;

const SEASON_FLOWER_FACTOR: Record<GardenSeason, number> = {
  spring: 1.2,
  summer: 1,
  autumn: 0.6,
  winter: 0.15,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function intensityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

export function bladesForDay(count: number, density: number): number {
  if (count <= 0) return 0;
  return Math.max(1, Math.round(clamp(1 + Math.floor(Math.log2(count)), 1, 6) * density));
}

export function distanceToPath(x: number, z: number): number {
  return Math.abs(PATH_SLOPE * x - z + PATH_INTERCEPT) / Math.hypot(PATH_SLOPE, 1);
}

/** Extra clearance between a year tree and an obstacle's radius. */
export const OBSTACLE_CLEARANCE = 0.6;

/** A 32-bit hash of two integers, for seeding per-item random streams. */
function hash2(a: number, b: number) {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (b >>> 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2d);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Separate streams for things drawn once per garden, not per year. */
const SHRUB_STREAM = 0x5348;
const ROCK_STREAM = 0x524b;

/** The island's radius for a history spanning this many years. */
export const islandRadiusForSpan = (spanYears: number) => clamp(9 + 0.28 * spanYears, 9, 13);
const islandRadiusFor = islandRadiusForSpan;
const treeRingRadiusFor = (islandRadius: number) => Math.max(7.4, 0.76 * islandRadius);

export function computeGardenLayout(input: MappingInput): GardenLayout {
  const { stats, activity, season, density } = input;
  const obstacles = input.obstacles ?? [];
  const blocked = (x: number, z: number) =>
    distanceToPath(x, z) < 1.1 ||
    obstacles.some(
      (o) => Math.hypot(x - o.x, z - o.z) < o.radius + OBSTACLE_CLEARANCE,
    );

  // Every year with any activity, ignoring visibleThrough: each one owns a
  // fixed slot on the ring, so trees don't move as the timeline plays.
  const allYearSet = new Set<number>();
  for (const d of input.days) {
    if (d.count > 0) allYearSet.add(Number(d.date.slice(0, 4)));
  }
  const allYears = [...allYearSet].sort((a, b) => a - b);

  const visible = input.days.filter(
    (d) => d.count > 0 && (input.visibleThrough === undefined || d.date <= input.visibleThrough),
  );

  const byYear = new Map<number, { total: number; activeDays: number; months: number[] }>();
  let lifetime = 0;
  for (const d of visible) {
    lifetime += d.count;
    const year = Number(d.date.slice(0, 4));
    const month = Number(d.date.slice(5, 7)) - 1;
    let entry = byYear.get(year);
    if (!entry) {
      entry = { total: 0, activeDays: 0, months: new Array<number>(12).fill(0) };
      byYear.set(year, entry);
    }
    entry.total += d.count;
    entry.activeDays += 1;
    entry.months[month] += d.count;
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  const spanYears = years.length === 0 ? 0 : years[years.length - 1] - years[0] + 1;
  const islandRadius = islandRadiusFor(spanYears);
  const treeRingRadius = treeRingRadiusFor(islandRadius);

  const firstYear = allYears[0] ?? 0;
  const fullSpan = allYears.length === 0 ? 0 : allYears[allYears.length - 1] - firstYear + 1;
  const fullRingRadius = treeRingRadiusFor(islandRadiusFor(fullSpan));
  const theta0 = Math.atan2(PATH_SLOPE, 1) + 0.35;
  const step = (2 * Math.PI) / Math.max(allYears.length, 6);
  const slotOf = new Map(allYears.map((year, slot) => [year, slot]));

  const yearTrees: YearTreeLayout[] = years.map((year) => {
    const entry = byYear.get(year)!;
    const slot = slotOf.get(year)!;
    const rand = mulberry32(hash2(input.seed, year));
    let theta = theta0 + slot * step + (rand() * 2 - 1) * 0.08;
    const jitter = (rand() * 2 - 1) * 0.35;
    const rotation = rand() * 2 * Math.PI;
    // The ring grows from where it is when this year first shows to the
    // full-history ring, so the nudge keeps the tree clear across that span
    // and the angle never depends on how much of the timeline is visible.
    const nearest = treeRingRadiusFor(islandRadiusFor(year - firstYear + 1)) + jitter;
    const furthest = fullRingRadius + jitter;
    const blockedAlong = (angle: number) => {
      for (let k = 0; k <= 4; k += 1) {
        const r = lerp(nearest, furthest, k / 4);
        if (blocked(r * Math.cos(angle), r * Math.sin(angle))) return true;
      }
      return false;
    };
    for (let tries = 0; tries < 3 && blockedAlong(theta); tries += 1) theta += 0.3;
    const r = treeRingRadius + jitter;
    let busiestMonth = 0;
    for (let m = 1; m < 12; m += 1) {
      if (entry.months[m] > entry.months[busiestMonth]) busiestMonth = m;
    }
    return {
      year,
      total: entry.total,
      activeDays: entry.activeDays,
      busiestMonth,
      scale: clamp(0.55 + 0.32 * Math.log10(1 + entry.total), 0.6, 1.9),
      x: r * Math.cos(theta),
      z: r * Math.sin(theta),
      rotation,
      evergreen: slot % 4 === 3,
    };
  });

  const social = stats.pullRequests + stats.issues;
  const flowerCount = Math.round(
    clamp(6 + 10 * Math.log2(1 + social), 6, 110) * density * SEASON_FLOWER_FACTOR[season],
  );
  const butterflyCount =
    season !== "spring" && season !== "summer"
      ? 0
      : activity <= 0.2
        ? 0
        : Math.max(1, Math.round(activity * 6));

  return {
    islandRadius,
    spanYears,
    lifetime,
    treeRingRadius,
    yearTrees,
    greatTree: {
      x: GREAT_TREE_POSITION.x,
      z: GREAT_TREE_POSITION.z,
      scale: clamp(0.9 + 0.22 * Math.log10(1 + lifetime), 0.9, 2.1),
      glowing: stats.streak >= 365,
    },
    pond: {
      x: POND_POSITION.x,
      z: POND_POSITION.z,
      scale: clamp(0.85 + 0.12 * Math.log10(1 + stats.repositories), 0.85, 1.25),
    },
    flowerCount,
    butterflyCount,
    birdCount: activity > 0.3 ? 2 + Math.round(activity * 4) : 0,
    fireflyCount: stats.streak >= 30 ? Math.min(40, Math.round(8 + stats.streak / 10)) : 0,
    shrubCount: Math.round(lerp(10, 16, mulberry32(hash2(input.seed, SHRUB_STREAM))()) * density),
    rockCount: Math.round(lerp(8, 12, mulberry32(hash2(input.seed, ROCK_STREAM))()) * density),
  };
}
