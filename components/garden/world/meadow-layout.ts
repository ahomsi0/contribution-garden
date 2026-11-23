import { bladesForDay, intensityLevel } from "./mapping";

/**
 * Pure year-ring placement for the contribution meadow. Each visible day with
 * contributions becomes a small clump of grass tufts on its year's ring: the
 * angle follows the day of the year, rings step outward one per year, and
 * tufts avoid the path and the (repository-scaled) pond.
 */

export interface MeadowDayInput {
  date: string;
  count: number;
}

export interface MeadowPond {
  x: number;
  z: number;
  /** The layout's repository-driven pond scale (1 = the base pond size). */
  scale: number;
}

export interface MeadowTuft {
  x: number;
  z: number;
  rotation: number;
  /** Per-tuft size jitter, grows with the level. */
  scale: number;
  /** 0..3, a stable per-tuft variant used for tilt. */
  variant: number;
  /** Index into the `days` array, or -1 for the no-calendar fallback. */
  dayIndex: number;
  /** `intensityLevel(count)`, 1..4 for drawn tufts. */
  level: number;
  /**
   * How many tufts this one stands for (>= 1). Above 1 only when the meadow
   * hit its instance budget; the renderer draws such tufts fuller.
   */
  girth: number;
  /** 0..1, stable per tuft (used for tip variation such as autumn gold). */
  tint: number;
}

export interface MeadowLayoutOptions {
  days: ReadonlyArray<MeadowDayInput>;
  /** Tier density multiplier (low 0.5, medium 0.8, high 1). */
  density: number;
  seed: number;
  /** ISO date; days after it are skipped. */
  visibleThrough?: string;
  pond: MeadowPond;
  /**
   * The most tufts to emit. When the data asks for more, every day keeps at
   * least one tuft and the rest of the budget is shared in proportion to
   * each day's extra tufts; the survivors carry the difference as `girth`.
   */
  maxTufts?: number;
}

export const MEADOW_BED_START = -Math.PI * 0.9;
export const MEADOW_BED_LENGTH = Math.PI * 1.5;
/** Instance budget at density 1. Scaled by the tier density. */
export const MEADOW_TUFT_BUDGET = 12_000;

/** Base pond semi-axes used for avoidance, before the pond scale. */
const POND_AVOID_X = 2.25;
const POND_AVOID_Z = 1.45;

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function isOutsideMeadowPond(
  x: number,
  z: number,
  pond: MeadowPond,
  padding = 1,
) {
  const semiX = POND_AVOID_X * pond.scale;
  const semiZ = POND_AVOID_Z * pond.scale;
  const distance =
    ((x - pond.x) * (x - pond.x)) / (semiX * semiX * padding) +
    ((z - pond.z) * (z - pond.z)) / (semiZ * semiZ * padding);
  return distance > 1;
}

export function meadowTuftBudget(density: number) {
  return Math.round(MEADOW_TUFT_BUDGET * density);
}

export function createMeadowLayout({
  days,
  density,
  seed,
  visibleThrough,
  pond,
  maxTufts = meadowTuftBudget(density),
}: MeadowLayoutOptions): MeadowTuft[] {
  if (days.length === 0) return [];

  const years = Array.from(
    new Set(days.map((day) => Number(day.date.slice(0, 4)))),
  ).sort((a, b) => a - b);
  const yearSlots = new Map(years.map((year, index) => [year, index]));
  const ringSpacing =
    years.length <= 1 ? 0 : Math.min(0.62, 3.55 / (years.length - 1));

  // First pass: how many tufts each visible day wants.
  const wanted = new Array<number>(days.length).fill(0);
  let activeDays = 0;
  let extraWanted = 0;
  days.forEach((day, dayIndex) => {
    if (visibleThrough && day.date > visibleThrough) return;
    const blades = bladesForDay(day.count, density);
    if (blades <= 0) return;
    wanted[dayIndex] = blades;
    activeDays += 1;
    extraWanted += blades - 1;
  });

  // Every day keeps one tuft; the rest of the budget is shared out.
  const budget = Math.max(maxTufts, activeDays);
  const share =
    activeDays + extraWanted <= budget || extraWanted === 0
      ? 1
      : (budget - activeDays) / extraWanted;
  let carry = 0;

  const items: MeadowTuft[] = [];

  days.forEach((day, dayIndex) => {
    const want = wanted[dayIndex];
    if (want <= 0) return;

    let tuftCount = want;
    if (share < 1) {
      carry += (want - 1) * share;
      const extra = Math.floor(carry);
      carry -= extra;
      tuftCount = 1 + extra;
    }
    const girth = want / tuftCount;

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
      MEADOW_BED_START + progress * MEADOW_BED_LENGTH + yearSlot * 0.012;
    const radius = 3.12 + yearSlot * ringSpacing;
    const level = intensityLevel(day.count);
    const random = seededRandom(hashString(`${seed}:${day.date}`));

    for (let tuftIndex = 0; tuftIndex < tuftCount; tuftIndex += 1) {
      const tangential = (random() - 0.5) * (0.18 + level * 0.045);
      const radial = (random() - 0.5) * (0.16 + level * 0.04);
      let localRadius = radius + radial;
      let x = Math.cos(angle) * localRadius - Math.sin(angle) * tangential;
      let z = Math.sin(angle) * localRadius + Math.cos(angle) * tangential;
      const pathDelta = z + x * 0.24 + 2.3;
      if (Math.abs(pathDelta) < 0.42) {
        z += (0.42 - Math.abs(pathDelta)) * (pathDelta >= 0 ? 1 : -1);
      }
      if (!isOutsideMeadowPond(x, z, pond, 1.55)) {
        localRadius += 0.72 * pond.scale;
        x = Math.cos(angle) * localRadius - Math.sin(angle) * tangential;
        z = Math.sin(angle) * localRadius + Math.cos(angle) * tangential;
      }

      items.push({
        x,
        z,
        rotation: random() * Math.PI * 2,
        scale: 0.5 + level * 0.12 + random() * 0.22,
        variant: Math.max(0, level - 1),
        dayIndex,
        level,
        girth,
        tint: random(),
      });
    }
  });

  return items;
}

/**
 * How many of a full-history meadow's tufts belong to days on or before
 * `visibleThrough`. Tufts come out in day order, so with a chronological
 * calendar the visible ones are a prefix: drawing that many instances
 * reveals the meadow without rebuilding it.
 */
export function visibleTuftCount(
  tufts: ReadonlyArray<MeadowTuft>,
  days: ReadonlyArray<MeadowDayInput>,
  visibleThrough: string | undefined,
) {
  if (visibleThrough === undefined) return tufts.length;
  let low = 0;
  let high = tufts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const day = days[tufts[middle].dayIndex];
    if (day && day.date <= visibleThrough) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Whether the calendar runs in date order, so `visibleTuftCount` applies. */
export function isChronological(days: ReadonlyArray<MeadowDayInput>) {
  for (let index = 1; index < days.length; index += 1) {
    if (days[index - 1].date > days[index].date) return false;
  }
  return true;
}

/**
 * The meadow when there is no contribution calendar: a loose scatter sized
 * by lifetime commits, kept off the path and the pond.
 */
export function createFallbackMeadow(
  commits: number,
  density: number,
  seed: number,
  pond: MeadowPond,
): MeadowTuft[] {
  const count = Math.round(
    (55 + Math.min(420, Math.sqrt(Math.max(0, commits)) * 8.5)) * density,
  );
  const random = seededRandom(seed);
  const items: MeadowTuft[] = [];
  const radius = 7.1;
  let attempts = 0;

  while (items.length < count && attempts < count * 18) {
    attempts += 1;
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;

    if (!isOutsideMeadowPond(x, z, pond, 1.08)) continue;
    if (Math.abs(z + x * 0.24 + 2.3) < 0.32 && random() > 0.18) continue;

    items.push({
      x,
      z,
      rotation: random() * Math.PI * 2,
      scale: 0.72 + random() * 0.72,
      variant: Math.floor(random() * 4),
      dayIndex: -1,
      level: 2,
      girth: 1,
      tint: random(),
    });
  }

  return items;
}
