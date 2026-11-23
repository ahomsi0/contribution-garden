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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isYearMonths(value: unknown): value is YearMonths {
  return (
    isRecord(value) &&
    Number.isInteger(value.year) &&
    Array.isArray(value.months) &&
    value.months.length === 12 &&
    value.months.every(isNonNegativeNumber)
  );
}

function isRankedUser(value: unknown): value is RankedUser {
  return (
    isRecord(value) &&
    Number.isInteger(value.rank) &&
    Number.isInteger(value.id) &&
    typeof value.login === "string" &&
    (value.name === null || typeof value.name === "string") &&
    typeof value.avatarUrl === "string" &&
    isNonNegativeNumber(value.score) &&
    Array.isArray(value.years) &&
    value.years.every(isYearMonths)
  );
}

export function isCountrySnapshot(value: unknown): value is CountrySnapshot {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isRecord(value.country) &&
    typeof value.country.slug === "string" &&
    typeof value.country.name === "string" &&
    typeof value.generatedAt === "string" &&
    isNonNegativeNumber(value.candidateCount) &&
    Array.isArray(value.users) &&
    value.users.every(isRankedUser)
  );
}

function isIndexEntry(value: unknown): value is RankingsIndexEntry {
  if (!isRecord(value)) return false;
  const leader = value.leader;
  return (
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    typeof value.updatedAt === "string" &&
    isNonNegativeNumber(value.userCount) &&
    (leader === null ||
      (isRecord(leader) &&
        typeof leader.login === "string" &&
        typeof leader.avatarUrl === "string" &&
        isNonNegativeNumber(leader.score)))
  );
}

export function isRankingsIndex(value: unknown): value is RankingsIndex {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.generatedAt === "string" &&
    Array.isArray(value.countries) &&
    value.countries.every(isIndexEntry)
  );
}

function indexEntry(snapshot: CountrySnapshot): RankingsIndexEntry {
  const leader = snapshot.users[0];
  return {
    slug: snapshot.country.slug,
    name: snapshot.country.name,
    updatedAt: snapshot.generatedAt,
    userCount: snapshot.users.length,
    leader: leader
      ? { login: leader.login, avatarUrl: leader.avatarUrl, score: leader.score }
      : null,
  };
}

/**
 * Combine freshly built snapshots with the previous index. Countries are
 * listed in `order` (config order); a country with neither a fresh snapshot
 * nor a previous entry is omitted.
 */
export function buildIndex(
  previous: RankingsIndex | null,
  fresh: readonly CountrySnapshot[],
  order: readonly string[],
  now: Date,
): RankingsIndex {
  const bySlug = new Map<string, RankingsIndexEntry>();
  for (const entry of previous?.countries ?? []) bySlug.set(entry.slug, entry);
  for (const snapshot of fresh) bySlug.set(snapshot.country.slug, indexEntry(snapshot));
  return {
    version: 1,
    generatedAt: now.toISOString(),
    countries: order.flatMap((slug) => {
      const entry = bySlug.get(slug);
      return entry ? [entry] : [];
    }),
  };
}
