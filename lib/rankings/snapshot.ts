export interface YearMonths {
  year: number;
  /** Exactly 12 monthly contribution totals, January first. */
  months: number[];
}

export interface UnrankedUser {
  /** GitHub databaseId — stable across renames. */
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  /** Lifetime total contributions. */
  score: number;
  /** Oldest year first. */
  years: YearMonths[];
}

export interface RankedUser extends UnrankedUser {
  /** 1-based competition ranking: 1, 2, 2, 4. */
  rank: number;
}

export interface CountrySnapshot {
  version: 1;
  country: { slug: string; name: string };
  generatedAt: string;
  candidateCount: number;
  users: RankedUser[];
}

export interface RankingsIndexEntry {
  slug: string;
  name: string;
  updatedAt: string;
  userCount: number;
  leader: { login: string; avatarUrl: string; score: number } | null;
}

export interface RankingsIndex {
  version: 1;
  generatedAt: string;
  countries: RankingsIndexEntry[];
}

export interface DailyCount {
  date: string;
  count: number;
}

export function rollUpMonths(days: readonly DailyCount[]): YearMonths[] {
  const byYear = new Map<number, number[]>();
  for (const day of days) {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(day.date);
    if (!match) continue;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    if (month < 0 || month > 11) continue;
    const months = byYear.get(year) ?? Array.from({ length: 12 }, () => 0);
    months[month] += Number.isFinite(day.count) && day.count > 0 ? day.count : 0;
    byYear.set(year, months);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, months]) => ({ year, months }));
}

export function scoreFromYears(years: readonly YearMonths[]): number {
  let total = 0;
  for (const year of years) for (const value of year.months) total += value;
  return total;
}

/**
 * First year that must be refetched on an incremental run. During January the
 * previous year is refetched too, because GitHub can still add late events.
 */
export function refetchFromYear(now: Date): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() === 0 ? year - 1 : year;
}

export function mergeWithPrevious(
  previous: readonly YearMonths[],
  fresh: readonly YearMonths[],
  refetchedFrom: number,
): YearMonths[] {
  const kept = previous.filter((year) => year.year < refetchedFrom);
  const added = fresh.filter((year) => year.year >= refetchedFrom);
  return [...kept, ...added].sort((a, b) => a.year - b.year);
}

export function rankUsers(users: readonly UnrankedUser[], limit: number): RankedUser[] {
  const sorted = [...users].sort(
    (a, b) => b.score - a.score || a.login.localeCompare(b.login),
  );
  const ranked: RankedUser[] = [];
  for (let index = 0; index < sorted.length && index < limit; index += 1) {
    const user = sorted[index];
    const previous = ranked[index - 1];
    const rank = previous && previous.score === user.score ? previous.rank : index + 1;
    ranked.push({ ...user, rank });
  }
  return ranked;
}
