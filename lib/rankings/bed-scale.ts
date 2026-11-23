import type { YearMonths } from "./snapshot";

/** Largest single monthly count across every user on a board. */
export function boardScaleMax(users: ReadonlyArray<{ years: readonly YearMonths[] }>): number {
  let max = 0;
  for (const user of users) {
    for (const year of user.years) {
      for (const value of year.months) if (value > max) max = value;
    }
  }
  return max;
}

/** Normalised 0..1 stem value on a log scale shared by the whole board. */
export function stemValue(count: number, scaleMax: number): number {
  if (!(scaleMax > 0) || !(count > 0)) return 0;
  return Math.min(1, Math.log1p(count) / Math.log1p(scaleMax));
}
