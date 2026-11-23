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

export function computeGardenLayout(input: MappingInput): GardenLayout {
  const { stats, activity, season, density } = input;
  const obstacles = input.obstacles ?? [];
  const blocked = (x: number, z: number) =>
    distanceToPath(x, z) < 1.1 ||
    obstacles.some(
      (o) => Math.hypot(x - o.x, z - o.z) < o.radius + OBSTACLE_CLEARANCE,
    );
  const rand = mulberry32(input.seed);

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
  const islandRadius = clamp(9 + 0.28 * spanYears, 9, 13);
  const treeRingRadius = Math.max(7.4, 0.76 * islandRadius);

  const n = years.length;
  const theta0 = Math.atan2(PATH_SLOPE, 1) + 0.35;
  const step = (2 * Math.PI) / Math.max(n, 6);
  const yearTrees: YearTreeLayout[] = years.map((year, i) => {
    const entry = byYear.get(year)!;
    let theta = theta0 + i * step + (rand() * 2 - 1) * 0.08;
    const r = treeRingRadius + (rand() * 2 - 1) * 0.35;
    let x = r * Math.cos(theta);
    let z = r * Math.sin(theta);
    for (let tries = 0; tries < 3 && blocked(x, z); tries += 1) {
      theta += 0.3;
      x = r * Math.cos(theta);
      z = r * Math.sin(theta);
    }
    const rotation = rand() * 2 * Math.PI;
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
      x,
      z,
      rotation,
      evergreen: i % 4 === 3,
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
    shrubCount: Math.round(lerp(10, 16, rand()) * density),
    rockCount: Math.round(lerp(8, 12, rand()) * density),
  };
}
