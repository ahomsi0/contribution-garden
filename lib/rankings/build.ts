import { mapWithConcurrency } from "@/lib/github/graphql";
import { locationNamesOtherCountry, searchTerms, type CountryConfig } from "./countries";
import type { FetchedUser, SearchUser } from "./github-source";
import {
  isCountrySnapshot,
  mergeWithPrevious,
  rankUsers,
  refetchFromYear,
  scoreFromYears,
  type CountrySnapshot,
  type RankingsIndex,
  type UnrankedUser,
} from "./snapshot";
import type { SnapshotStore } from "./snapshot-store";

export interface BuildDeps {
  store: SnapshotStore;
  now: Date;
  candidateLimit: number;
  publicLimit: number;
  search: (aliases: readonly string[], limit: number) => Promise<SearchUser[]>;
  fetchUser: (login: string, fromYear: number | null, now: Date) => Promise<FetchedUser | null>;
  log: (message: string) => void;
  concurrency?: number;
}

export const candidatesPath = (slug: string) => `rankings/${slug}.candidates.json`;
export const publicPath = (slug: string) => `rankings/${slug}.json`;
export const INDEX_PATH = "rankings/index.json";

function isFatal(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  return status === 401 || status === 429;
}

export async function buildCountry(country: CountryConfig, deps: BuildDeps): Promise<CountrySnapshot> {
  const previousRaw = await deps.store.read(candidatesPath(country.slug));
  const previous = isCountrySnapshot(previousRaw) ? previousRaw : null;
  const previousById = new Map(previous?.users.map((user) => [user.id, user]));
  const refetchFrom = refetchFromYear(deps.now);

  const candidates = await deps.search(searchTerms(country), deps.candidateLimit);
  deps.log(`${country.slug}: ${candidates.length} candidates`);

  let failures = 0;
  const results = await mapWithConcurrency(candidates, deps.concurrency ?? 4, async (candidate) => {
    const known = previousById.get(candidate.id);
    try {
      const fetched = await deps.fetchUser(candidate.login, known ? refetchFrom : null, deps.now);
      if (!fetched) return null;
      if (locationNamesOtherCountry(country, fetched.location)) {
        deps.log(`${country.slug}: excluded ${fetched.login} (${fetched.location})`);
        return null;
      }
      const years = known ? mergeWithPrevious(known.years, fetched.years, refetchFrom) : fetched.years;
      const user: UnrankedUser = {
        id: fetched.id,
        login: fetched.login,
        name: fetched.name,
        avatarUrl: fetched.avatarUrl,
        years,
        score: scoreFromYears(years),
      };
      return user;
    } catch (error) {
      if (isFatal(error)) throw error;
      failures += 1;
      deps.log(`${country.slug}: skipped ${candidate.login} (${(error as Error).message})`);
      return null;
    }
  });

  // Publishing a board that silently lost a big share of people is worse than
  // keeping yesterday's: fail the country so its previous files stay in place.
  const maxFailures = Math.max(5, Math.floor(candidates.length * 0.2));
  if (failures > maxFailures) {
    throw new Error(`${country.slug}: ${failures} of ${candidates.length} candidates failed`);
  }

  const users = results.filter((user): user is UnrankedUser => user !== null);
  const ranked = rankUsers(users, users.length);
  const base = {
    version: 1 as const,
    country: { slug: country.slug, name: country.name },
    generatedAt: deps.now.toISOString(),
    candidateCount: users.length,
  };
  const candidateSnapshot: CountrySnapshot = { ...base, users: ranked };
  const snapshot: CountrySnapshot = { ...base, users: ranked.slice(0, deps.publicLimit) };
  if (!isCountrySnapshot(candidateSnapshot) || !isCountrySnapshot(snapshot)) {
    throw new Error(`${country.slug}: built snapshot failed validation`);
  }
  await deps.store.write(candidatesPath(country.slug), candidateSnapshot);
  await deps.store.write(publicPath(country.slug), snapshot);
  return snapshot;
}

/** Countries with no snapshot first, then least recently updated. */
export function orderCountriesByStaleness(
  countries: readonly CountryConfig[],
  index: RankingsIndex | null,
): CountryConfig[] {
  const updated = new Map(index?.countries.map((entry) => [entry.slug, Date.parse(entry.updatedAt)]));
  // A finite sentinel: (-Infinity) - (-Infinity) would be NaN and break sort.
  const time = (slug: string) => updated.get(slug) ?? Number.MIN_SAFE_INTEGER;
  return [...countries].sort((a, b) => time(a.slug) - time(b.slug));
}
