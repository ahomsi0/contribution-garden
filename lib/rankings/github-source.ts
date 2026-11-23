import { GitHubRequestError, chunk, fetchGraphQL, type GitHubAuthorization } from "@/lib/github/graphql";
import { yearRange } from "@/lib/github/history-query";
import { rollUpMonths, type DailyCount, type YearMonths } from "./snapshot";

export interface SearchUser {
  id: number;
  login: string;
}

export interface SearchDeps {
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const SEARCH_URL = "https://api.github.com/search/users";
const SEARCH_PAGE_SIZE = 100;
const SEARCH_RESULT_CAP = 1_000;
/** 30 search requests per minute → one every 2 s, plus a margin. */
export const SEARCH_THROTTLE_MS = 2_100;

export const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const MAX_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 10 * 60_000;

export async function withRetry<T>(
  operation: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof GitHubRequestError) || attempt >= MAX_ATTEMPTS) throw error;
      if (error.status === 429) {
        await sleep(Math.min((error.retryAfterSeconds ?? 60) * 1_000, MAX_RETRY_WAIT_MS));
      } else if (error.status === 502) {
        await sleep(5_000 * attempt);
      } else {
        throw error;
      }
    }
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

async function searchAlias(
  alias: string,
  maxResults: number,
  deps: Required<SearchDeps>,
  throttle: () => Promise<void>,
): Promise<SearchUser[]> {
  const results: SearchUser[] = [];
  const pages = Math.ceil(Math.min(maxResults, SEARCH_RESULT_CAP) / SEARCH_PAGE_SIZE);
  for (let page = 1; page <= pages; page += 1) {
    await throttle();
    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", `location:"${alias}" followers:>10 type:user`);
    url.searchParams.set("sort", "followers");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", String(SEARCH_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    const body = await withRetry(async () => {
      let response: Response;
      try {
        response = await deps.fetchImpl(url, {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${deps.token}`,
            "User-Agent": "Contribution-Garden-Rankings",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        if (isTimeoutError(error)) throw new GitHubRequestError("GitHub search timed out.", 502);
        throw error;
      }
      if (!response.ok) {
        const retryAfterHeader = response.headers.get("retry-after");
        const parsed = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
        const retryAfterSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
        const rateLimited =
          response.status === 429 ||
          (response.status === 403 &&
            (response.headers.get("x-ratelimit-remaining") === "0" || retryAfterHeader !== null));
        const status = response.status === 401 ? 401 : rateLimited ? 429 : 502;
        throw new GitHubRequestError(
          `GitHub search failed with status ${response.status} for "${alias}".`,
          status,
          retryAfterSeconds,
        );
      }
      return (await response.json()) as { items?: Array<{ id: number; login: string }> };
    }, deps.sleep);
    const items = body.items ?? [];
    for (const item of items) results.push({ id: item.id, login: item.login });
    if (items.length < SEARCH_PAGE_SIZE) break;
  }
  return results;
}

export async function searchCandidates(
  aliases: readonly string[],
  limit: number,
  deps: SearchDeps,
): Promise<SearchUser[]> {
  const resolved: Required<SearchDeps> = {
    token: deps.token,
    fetchImpl: deps.fetchImpl ?? fetch,
    sleep: deps.sleep ?? defaultSleep,
  };
  let first = true;
  const throttle = async () => {
    if (!first) await resolved.sleep(SEARCH_THROTTLE_MS);
    first = false;
  };

  const lists: SearchUser[][] = [];
  for (const alias of aliases) {
    lists.push(await searchAlias(alias, limit, resolved, throttle));
  }

  const seen = new Set<number>();
  const merged: SearchUser[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let position = 0; position < longest && merged.length < limit; position += 1) {
    for (const list of lists) {
      const user = list[position];
      if (!user || seen.has(user.id)) continue;
      seen.add(user.id);
      merged.push(user);
      if (merged.length >= limit) break;
    }
  }
  return merged;
}


export interface FetchedUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  /** Free-text profile location, or null. */
  location: string | null;
  /** Only the years that were fetched, oldest first. */
  years: YearMonths[];
}

export interface HistoryDeps {
  token: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const HISTORY_CHUNK = 4;
const RATE_LIMIT_FLOOR = 200;
const RESET_MARGIN_MS = 5_000;

interface RawHistory {
  rateLimit: { remaining: number; resetAt: string };
  user:
    | ({
        databaseId: number | null;
        login: string;
        name: string | null;
        avatarUrl: string;
        location: string | null;
        contributionsCollection: { contributionYears: number[] };
      } & Record<string, unknown>)
    | null;
}

interface RawYear {
  contributionCalendar: {
    weeks: Array<{ contributionDays: Array<{ date: string; contributionCount: number }> }>;
  };
}

function historyQuery(years: readonly number[], now: Date): string {
  const selections = years
    .map((year) => {
      const { from, to } = yearRange(year, now);
      return `y${year}: contributionsCollection(from: "${from}", to: "${to}") {
        contributionCalendar { weeks { contributionDays { date contributionCount } } }
      }`;
    })
    .join("\n");
  return `query RankingHistory($login: String!) {
    rateLimit { remaining resetAt }
    user(login: $login) {
      databaseId login name avatarUrl location
      contributionsCollection { contributionYears }
      ${selections}
    }
  }`;
}

function yearsBetween(from: number, to: number): number[] {
  const years: number[] = [];
  for (let year = from; year <= to; year += 1) years.push(year);
  return years;
}

export async function fetchUserHistory(
  login: string,
  fromYear: number | null,
  now: Date,
  deps: HistoryDeps,
): Promise<FetchedUser | null> {
  const sleep = deps.sleep ?? defaultSleep;
  const clock = deps.now ?? (() => new Date());
  const authorization: GitHubAuthorization = {
    header: `Bearer ${deps.token}`,
    kind: "rankings",
    cacheScope: "rankings",
  };
  const currentYear = now.getUTCFullYear();

  const run = async (years: number[]): Promise<RawHistory> => {
    const data = await withRetry(
      () =>
        fetchGraphQL<RawHistory>(authorization, historyQuery(years, now), { login }, { timeoutMs: 40_000 }),
      sleep,
    );
    if (data.rateLimit.remaining < RATE_LIMIT_FLOOR) {
      const wait = Date.parse(data.rateLimit.resetAt) - clock().getTime() + RESET_MARGIN_MS;
      if (wait > 0) await sleep(Math.min(wait, 65 * 60_000));
    }
    return data;
  };

  const days: DailyCount[] = [];
  const collect = (data: RawHistory, years: number[]) => {
    for (const year of years) {
      const raw = data.user?.[`y${year}`] as RawYear | undefined;
      for (const week of raw?.contributionCalendar.weeks ?? []) {
        for (const day of week.contributionDays) {
          if (!day.date.startsWith(`${year}-`)) continue;
          days.push({ date: day.date, count: day.contributionCount });
        }
      }
    }
  };

  const firstYears = yearsBetween(fromYear ?? currentYear - 1, currentYear);
  let first: RawHistory;
  try {
    first = await run(firstYears);
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) return null;
    throw error;
  }
  if (!first.user) return null;
  const databaseId = first.user.databaseId;
  if (databaseId === null || !Number.isInteger(databaseId) || databaseId <= 0) return null;
  collect(first, firstYears);

  if (fromYear === null) {
    const earliest = Math.min(currentYear, ...first.user.contributionsCollection.contributionYears);
    const remaining = yearsBetween(earliest, firstYears[0] - 1);
    for (const years of chunk(remaining, HISTORY_CHUNK)) {
      collect(await run(years), years);
    }
  }

  const unique = new Map(days.map((day) => [day.date, day]));
  const fetchedFrom = fromYear ?? Math.min(currentYear, ...first.user.contributionsCollection.contributionYears);
  const rolled = rollUpMonths([...unique.values()]);
  const byYear = new Map(rolled.map((year) => [year.year, year]));
  return {
    id: databaseId,
    login: first.user.login,
    name: first.user.name,
    avatarUrl: first.user.avatarUrl,
    location: first.user.location ?? null,
    years: yearsBetween(fetchedFrom, currentYear).map(
      (year) => byYear.get(year) ?? { year, months: Array.from({ length: 12 }, () => 0) },
    ),
  };
}
