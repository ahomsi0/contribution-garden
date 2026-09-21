import {
  deriveCalendarMetrics,
  normalizeGitHubContributionLevel,
  type ContributionDay,
  type GitHubGardenData,
  type GitHubLanguage,
  type GitHubRepository,
} from "@/lib/github-types";
import {
  forceRefreshGitHubSession,
  resolveGitHubSession,
  serializeClearGitHubSessionCookie,
} from "@/lib/github-auth";
import { createMockGitHubData } from "@/lib/mock-github";
import { logger } from "@/lib/logger";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REPOSITORY_PAGES = 10;
const HISTORY_CHUNK_SIZE = 4;
const HISTORY_CONCURRENCY = 3;
const FALLBACK_COLOR = "#7a8b78";
const PUBLIC_GARDEN_CACHE_TTL_MS = 30 * 60 * 1_000;
const PUBLIC_GARDEN_STALE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_PUBLIC_GARDEN_CACHE_ENTRIES = 24;
/**
 * Short negative cache: after GitHub fails for a username we stop re-hitting
 * the upstream API for this window. Prevents an outage plus traffic from
 * amplifying into maximal load on a struggling GitHub.
 */
const NEGATIVE_CACHE_TTL_MS = 30_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;

const LIVE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=21600",
  Vary: "Accept-Encoding",
  "X-Contribution-Garden-Source": "github",
};

const DEMO_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=21600",
  Vary: "Accept-Encoding",
  "X-Contribution-Garden-Source": "demo",
};

const SESSION_LIVE_CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Accept-Encoding",
  "X-Contribution-Garden-Source": "github",
};

function gardenApiRateLimit(): { limit: number; windowMs: number } {
  const configured = Number.parseInt(
    process.env.GARDEN_API_RATE_LIMIT?.trim() ?? "",
    10,
  );
  return {
    limit:
      Number.isFinite(configured) && configured > 0 && configured <= 10_000
        ? configured
        : DEFAULT_RATE_LIMIT_PER_MINUTE,
    windowMs: 60_000,
  };
}

const PROFILE_QUERY = /* GraphQL */ `
  query ContributionGardenProfile($login: String!) {
    user(login: $login) {
      login
      name
      bio
      avatarUrl
      url
      location
      company
      websiteUrl
      createdAt
      followers { totalCount }
      following { totalCount }
      repositories(
        first: 100
        ownerAffiliations: [OWNER]
        privacy: PUBLIC
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          nameWithOwner
          url
          description
          stargazerCount
          forkCount
          isArchived
          updatedAt
          primaryLanguage { name color }
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
      contributionsCollection {
        contributionYears
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        contributionCalendar { totalContributions }
      }
    }
  }
`;

const REPOSITORY_PAGE_QUERY = /* GraphQL */ `
  query ContributionGardenRepositories($login: String!, $after: String!) {
    user(login: $login) {
      repositories(
        first: 100
        after: $after
        ownerAffiliations: [OWNER]
        privacy: PUBLIC
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          nameWithOwner
          url
          description
          stargazerCount
          forkCount
          isArchived
          updatedAt
          primaryLanguage { name color }
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
    }
  }
`;

const HISTORY_FIELDS = /* GraphQL */ `
  totalCommitContributions
  totalIssueContributions
  totalPullRequestContributions
  totalPullRequestReviewContributions
  restrictedContributionsCount
  contributionCalendar {
    totalContributions
    weeks {
      contributionDays {
        date
        weekday
        contributionCount
        contributionLevel
        color
      }
    }
  }
  commitContributionsByRepository(maxRepositories: 25) {
    repository { nameWithOwner isPrivate }
    contributions(first: 100) {
      nodes { occurredAt commitCount }
    }
  }
`;

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string; type?: string }>;
}

class GitHubRequestError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 404 | 429 | 502,
  ) {
    super(message);
    this.name = "GitHubRequestError";
  }
}

type GitHubAuthorizationKind = "oauth-app" | "server-token" | "user-session";

interface GitHubAuthorization {
  header: string;
  kind: GitHubAuthorizationKind;
  cacheScope: string;
}

interface GitHubServerAuthorization {
  credential: GitHubAuthorization | null;
  incomplete: boolean;
}

interface PublicGardenCacheEntry {
  data: GitHubGardenData;
  freshUntil: number;
  staleUntil: number;
}

interface PublicGardenFailure {
  error: GitHubRequestError;
  retryAt: number;
}

type PublicGardenCacheStatus = "hit" | "miss" | "stale";

const publicGardenCache = new Map<string, PublicGardenCacheEntry>();
const publicGardenLoads = new Map<string, Promise<GitHubGardenData>>();
const publicGardenFailures = new Map<string, PublicGardenFailure>();

interface RawLanguageEdge {
  size: number;
  node: { name: string; color: string | null };
}

interface RawRepository {
  name: string;
  nameWithOwner: string;
  url: string;
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  isArchived: boolean;
  updatedAt: string;
  primaryLanguage: { name: string; color: string | null } | null;
  languages: { edges: Array<RawLanguageEdge | null> };
}

interface RawRepositoryConnection {
  totalCount?: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: Array<RawRepository | null>;
}

interface RawProfileQuery {
  user: {
    login: string;
    name: string | null;
    bio: string | null;
    avatarUrl: string;
    url: string;
    location: string | null;
    company: string | null;
    websiteUrl: string | null;
    createdAt: string;
    followers: { totalCount: number };
    following: { totalCount: number };
    repositories: RawRepositoryConnection & { totalCount: number };
    contributionsCollection: {
      contributionYears: number[];
      totalCommitContributions: number;
      totalIssueContributions: number;
      totalPullRequestContributions: number;
      totalPullRequestReviewContributions: number;
      contributionCalendar: { totalContributions: number };
    };
  } | null;
}

interface RawRepositoryPageQuery {
  user: { repositories: RawRepositoryConnection } | null;
}

interface RawContributionDay {
  date: string;
  weekday: number;
  contributionCount: number;
  contributionLevel: string;
  color: string;
}

interface RawContributionCollection {
  totalCommitContributions: number;
  totalIssueContributions: number;
  totalPullRequestContributions: number;
  totalPullRequestReviewContributions: number;
  restrictedContributionsCount: number;
  contributionCalendar: {
    totalContributions: number;
    weeks: Array<{ contributionDays: RawContributionDay[] }>;
  };
  commitContributionsByRepository: Array<{
    repository: { nameWithOwner: string; isPrivate: boolean };
    contributions: {
      nodes: Array<{ occurredAt: string; commitCount: number } | null>;
    };
  }>;
}

interface RawHistoryQuery {
  user: Record<string, RawContributionCollection | null> | null;
}

function githubServerAuthorization(): GitHubServerAuthorization {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim() ?? "";
  if (clientId || clientSecret) {
    if (!clientId || !clientSecret) {
      return { credential: null, incomplete: true };
    }
    return {
      credential: {
        header: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        kind: "oauth-app",
        cacheScope: `oauth-app:${clientId}`,
      },
      incomplete: false,
    };
  }

  const token = process.env.GITHUB_TOKEN?.trim();
  return {
    credential: token
      ? {
          header: `Bearer ${token}`,
          kind: "server-token",
          cacheScope: "server-token",
        }
      : null,
    incomplete: false,
  };
}

async function fetchGraphQL<T>(
  authorization: GitHubAuthorization,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: authorization.header,
        "Content-Type": "application/json",
        "User-Agent": "Contribution-Garden",
      },
      body: JSON.stringify({ query, variables }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      // GitHub reports exhausted rate limits as 403 *or* 429; disambiguate via
      // the rate-limit headers so credential-scope problems are not misread as
      // quota exhaustion.
      const rateLimited =
        response.status === 429 ||
        (response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0");
      const status =
        response.status === 401 ? 401 : rateLimited ? 429 : 502;
      logger.warn("github_graphql_http_error", {
        upstreamStatus: response.status,
        mappedStatus: status,
        kind: authorization.kind,
      });
      throw new GitHubRequestError(
        `GitHub GraphQL request failed with status ${response.status}.`,
        status,
      );
    }

    const payload = (await response.json()) as GraphQLResponse<T>;
    if (payload.errors?.length) {
      const firstError = payload.errors[0];
      const message = firstError?.message ?? "GitHub returned a GraphQL error.";
      const status =
        /bad credentials|requires authentication|authentication token/i.test(message)
          ? 401
          : firstError?.type === "NOT_FOUND"
            ? 404
            : firstError?.type === "RATE_LIMITED" || /rate limit/i.test(message)
              ? 429
              : 502;
      logger.warn("github_graphql_errors_payload", {
        mappedStatus: status,
        type: firstError?.type ?? null,
        kind: authorization.kind,
      });
      throw new GitHubRequestError(message, status);
    }
    if (!payload.data) {
      throw new GitHubRequestError("GitHub returned no data.", 502);
    }

    return payload.data;
  } catch (error) {
    if (error instanceof GitHubRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      logger.warn("github_graphql_timeout", { kind: authorization.kind });
      throw new GitHubRequestError("The GitHub request timed out.", 502);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await task(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function contributionHistoryQuery(years: readonly number[], now: Date): string {
  const currentYear = now.getUTCFullYear();
  const selections = years
    .map((year) => {
      const from = `${year}-01-01T00:00:00.000Z`;
      const to =
        year === currentYear
          ? now.toISOString()
          : new Date(Date.UTC(year + 1, 0, 1) - 1_000).toISOString();
      return `
        y${year}: contributionsCollection(from: "${from}", to: "${to}") {
          ${HISTORY_FIELDS}
        }
      `;
    })
    .join("\n");

  return `
    query ContributionGardenHistory($login: String!) {
      user(login: $login) {
        ${selections}
      }
    }
  `;
}

async function fetchContributionHistory(
  authorization: GitHubAuthorization,
  login: string,
  contributionYears: readonly number[],
  now: Date,
): Promise<Map<number, RawContributionCollection>> {
  const currentYear = now.getUTCFullYear();
  const validYears = contributionYears.filter(
    (year) => Number.isInteger(year) && year >= 2008 && year <= currentYear,
  );
  const earliestYear =
    validYears.length > 0 ? Math.min(...validYears) : currentYear;
  const yearsToFetch = Array.from(
    { length: currentYear - earliestYear + 1 },
    (_, index) => currentYear - index,
  );

  const collections = new Map<number, RawContributionCollection>();
  const yearChunks = chunk(yearsToFetch, HISTORY_CHUNK_SIZE);

  // History chunks are independent queries, so they run with bounded
  // concurrency instead of one-at-a-time; a decade of history drops from ~3
  // sequential round trips to 1 wave.
  await mapWithConcurrency(yearChunks, HISTORY_CONCURRENCY, async (yearChunk) => {
    const data = await fetchGraphQL<RawHistoryQuery>(
      authorization,
      contributionHistoryQuery(yearChunk, now),
      { login },
    );

    if (!data.user) {
      throw new GitHubRequestError(
        "GitHub user was not found while loading contribution history.",
        404,
      );
    }

    for (const year of yearChunk) {
      const collection = data.user[`y${year}`];
      if (collection) collections.set(year, collection);
    }
  });

  return collections;
}

async function fetchAllRepositories(
  authorization: GitHubAuthorization,
  login: string,
  firstPage: RawRepositoryConnection,
): Promise<{ repositories: RawRepository[]; truncated: boolean }> {
  const repositories = firstPage.nodes.filter(
    (repository): repository is RawRepository => Boolean(repository),
  );
  let pageInfo = firstPage.pageInfo;
  let pagesLoaded = 1;

  while (
    pageInfo.hasNextPage &&
    pageInfo.endCursor &&
    pagesLoaded < MAX_REPOSITORY_PAGES
  ) {
    const data = await fetchGraphQL<RawRepositoryPageQuery>(
      authorization,
      REPOSITORY_PAGE_QUERY,
      { login, after: pageInfo.endCursor },
    );
    if (!data.user) break;

    repositories.push(
      ...data.user.repositories.nodes.filter(
        (repository): repository is RawRepository => Boolean(repository),
      ),
    );
    pageInfo = data.user.repositories.pageInfo;
    pagesLoaded += 1;
  }

  return { repositories, truncated: pageInfo.hasNextPage };
}

function normalizeLanguages(repositories: readonly RawRepository[]): GitHubLanguage[] {
  const totals = new Map<string, { bytes: number; color: string }>();

  for (const repository of repositories) {
    for (const edge of repository.languages.edges) {
      if (!edge) continue;
      const previous = totals.get(edge.node.name);
      totals.set(edge.node.name, {
        bytes: (previous?.bytes ?? 0) + edge.size,
        color: edge.node.color ?? previous?.color ?? FALLBACK_COLOR,
      });
    }
  }

  const totalBytes = [...totals.values()].reduce(
    (sum, language) => sum + language.bytes,
    0,
  );

  return [...totals.entries()]
    .map(([name, language]) => ({
      name,
      color: language.color,
      bytes: language.bytes,
      percentage:
        totalBytes === 0
          ? 0
          : Math.round((language.bytes / totalBytes) * 1_000) / 10,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
}

function normalizeRepositories(
  repositories: readonly RawRepository[],
): GitHubRepository[] {
  return repositories
    .map((repository) => ({
      name: repository.name,
      nameWithOwner: repository.nameWithOwner,
      url: repository.url,
      description: repository.description,
      stars: repository.stargazerCount,
      forks: repository.forkCount,
      primaryLanguage: repository.primaryLanguage?.name ?? null,
      primaryLanguageColor:
        repository.primaryLanguage?.color ?? FALLBACK_COLOR,
      updatedAt: repository.updatedAt,
      isArchived: repository.isArchived,
    }))
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 24);
}

function normalizeCalendar(
  collections: ReadonlyMap<number, RawContributionCollection>,
  now: Date,
): ContributionDay[] {
  const repositoriesByDate = new Map<string, Set<string>>();

  for (const collection of collections.values()) {
    for (const repositoryContributions of collection.commitContributionsByRepository) {
      if (repositoryContributions.repository.isPrivate) continue;
      for (const contribution of repositoryContributions.contributions.nodes) {
        if (!contribution || contribution.commitCount <= 0) continue;
        const date = contribution.occurredAt.slice(0, 10);
        const repositories = repositoriesByDate.get(date) ?? new Set<string>();
        repositories.add(repositoryContributions.repository.nameWithOwner);
        repositoriesByDate.set(date, repositories);
      }
    }
  }

  const daysByDate = new Map<string, Omit<ContributionDay, "week">>();
  for (const collection of collections.values()) {
    for (const week of collection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) {
        daysByDate.set(day.date, {
          date: day.date,
          count: day.contributionCount,
          level: normalizeGitHubContributionLevel(
            day.contributionLevel,
            day.contributionCount,
          ),
          weekday: day.weekday,
          color: day.color || FALLBACK_COLOR,
          repositories: [...(repositoriesByDate.get(day.date) ?? [])].sort(),
        });
      }
    }
  }

  const today = now.toISOString().slice(0, 10);
  const ordered = [...daysByDate.values()]
    .filter((day) => day.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (ordered.length === 0) return [];

  const firstDate = Date.parse(`${ordered[0].date}T00:00:00Z`);
  const firstWeekday = ordered[0].weekday;
  return ordered.map((day) => ({
    ...day,
    week: Math.floor(
      (Math.floor((Date.parse(`${day.date}T00:00:00Z`) - firstDate) / 86_400_000) +
        firstWeekday) /
        7,
    ),
  }));
}

async function loadGitHubGarden(
  login: string,
  authorization: GitHubAuthorization,
): Promise<GitHubGardenData> {
  const startedAt = Date.now();
  const now = new Date();
  const profileData = await fetchGraphQL<RawProfileQuery>(
    authorization,
    PROFILE_QUERY,
    { login },
  );
  const user = profileData.user;
  if (!user) throw new GitHubRequestError("GitHub user was not found.", 404);

  const [repositoryResult, collections] = await Promise.all([
    fetchAllRepositories(authorization, user.login, user.repositories),
    fetchContributionHistory(
      authorization,
      user.login,
      user.contributionsCollection.contributionYears,
      now,
    ),
  ]);

  const calendar = normalizeCalendar(collections, now);
  const derived = deriveCalendarMetrics(calendar, now);
  const totals = {
    totalContributions:
      user.contributionsCollection.contributionCalendar.totalContributions,
    commits: user.contributionsCollection.totalCommitContributions,
    pullRequests: user.contributionsCollection.totalPullRequestContributions,
    issues: user.contributionsCollection.totalIssueContributions,
    pullRequestReviews:
      user.contributionsCollection.totalPullRequestReviewContributions,
  };
  const stars = repositoryResult.repositories.reduce(
    (sum, repository) => sum + repository.stargazerCount,
    0,
  );
  const contributionYears = [
    ...new Set(user.contributionsCollection.contributionYears),
  ].sort((a, b) => b - a);

  logger.info("github_garden_loaded", {
    login: user.login,
    kind: authorization.kind,
    durationMs: Date.now() - startedAt,
    years: collections.size,
    truncatedRepos: repositoryResult.truncated,
  });

  return {
    profile: {
      login: user.login,
      name: user.name?.trim() || user.login,
      bio: user.bio?.trim() || "",
      avatarUrl: user.avatarUrl,
      url: user.url,
      location: user.location,
      company: user.company,
      websiteUrl: user.websiteUrl,
      joinedAt: user.createdAt,
      followers: user.followers.totalCount,
      following: user.following.totalCount,
      repositories: user.repositories.totalCount,
      stars,
    },
    metrics: {
      ...totals,
      repositories: user.repositories.totalCount,
      stars,
      followers: user.followers.totalCount,
      ...derived,
    },
    calendar,
    languages: normalizeLanguages(repositoryResult.repositories),
    repositories: normalizeRepositories(repositoryResult.repositories),
    contributionYears,
    source: "github",
    fetchedAt: now.toISOString(),
    notice: repositoryResult.truncated
      ? `Star and language totals cover the first ${MAX_REPOSITORY_PAGES * 100} public repositories.`
      : undefined,
  };
}

function prunePublicGardenCache() {
  while (publicGardenCache.size > MAX_PUBLIC_GARDEN_CACHE_ENTRIES) {
    const oldestKey = publicGardenCache.keys().next().value;
    if (!oldestKey) return;
    publicGardenCache.delete(oldestKey);
    publicGardenFailures.delete(oldestKey);
  }
}

function staleCopy(cached: PublicGardenCacheEntry): GitHubGardenData {
  return {
    ...cached.data,
    notice: cached.data.notice
      ? `${cached.data.notice} Showing recently cached GitHub data while GitHub is unavailable.`
      : "Showing recently cached GitHub data while GitHub is unavailable.",
  };
}

async function loadPublicGitHubGarden(
  username: string,
  authorization: GitHubAuthorization,
): Promise<{ data: GitHubGardenData; cacheStatus: PublicGardenCacheStatus }> {
  const cacheKey = `${authorization.cacheScope}:${username}`;
  const cached = publicGardenCache.get(cacheKey);

  if (cached && cached.freshUntil > Date.now()) {
    publicGardenCache.delete(cacheKey);
    publicGardenCache.set(cacheKey, cached);
    return { data: cached.data, cacheStatus: "hit" };
  }

  let pending = publicGardenLoads.get(cacheKey);

  if (!pending) {
    // Negative-cache window: do not hammer GitHub again immediately after a
    // failure. Prefer serving a stale copy when one exists.
    const failure = publicGardenFailures.get(cacheKey);
    if (failure && failure.retryAt > Date.now()) {
      if (cached && cached.staleUntil > Date.now()) {
        publicGardenCache.delete(cacheKey);
        publicGardenCache.set(cacheKey, cached);
        return { data: staleCopy(cached), cacheStatus: "stale" };
      }
      throw failure.error;
    }

    pending = loadGitHubGarden(username, authorization).then(
      (data) => {
        const cachedAt = Date.now();
        publicGardenCache.set(cacheKey, {
          data,
          freshUntil: cachedAt + PUBLIC_GARDEN_CACHE_TTL_MS,
          staleUntil: cachedAt + PUBLIC_GARDEN_STALE_TTL_MS,
        });
        publicGardenFailures.delete(cacheKey);
        prunePublicGardenCache();
        return data;
      },
      (error: unknown) => {
        const requestError =
          error instanceof GitHubRequestError
            ? error
            : new GitHubRequestError(
                "The garden could not be loaded.",
                502,
              );
        // Back off briefly for every failure shape — outages, rate limits,
        // and unknown users alike — so bursts of traffic during a GitHub
        // incident cannot amplify into sustained upstream load.
        publicGardenFailures.set(cacheKey, {
          error: requestError,
          retryAt: Date.now() + NEGATIVE_CACHE_TTL_MS,
        });
        throw requestError;
      },
    );
    publicGardenLoads.set(cacheKey, pending);
  }

  try {
    return { data: await pending, cacheStatus: "miss" };
  } catch (error) {
    if (cached && cached.staleUntil > Date.now()) {
      // Re-insert so a frequently requested entry survives LRU eviction even
      // while upstream is failing.
      publicGardenCache.delete(cacheKey);
      publicGardenCache.set(cacheKey, cached);
      return { data: staleCopy(cached), cacheStatus: "stale" };
    }
    throw error;
  } finally {
    if (publicGardenLoads.get(cacheKey) === pending) {
      publicGardenLoads.delete(cacheKey);
    }
  }
}

function isValidUsername(username: string): boolean {
  return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username);
}

interface RouteContext {
  params: Promise<{ username: string }>;
}

function responseHeaders(
  initial: HeadersInit,
  setCookie?: string,
): Headers {
  const headers = new Headers(initial);
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return headers;
}

function publicLiveHeaders(cacheStatus: PublicGardenCacheStatus): Headers {
  const headers = new Headers(LIVE_CACHE_HEADERS);
  headers.set("X-Contribution-Garden-Cache", cacheStatus);
  return headers;
}

export async function GET(request: Request, context: RouteContext) {
  const startedAt = Date.now();
  const finishLog = (
    outcome: Record<string, string | number | boolean | null>,
  ) =>
    logger.info("garden_api_request", {
      route: "/api/github/[username]",
      durationMs: Date.now() - startedAt,
      ...outcome,
    });

  const { username: rawUsername } = await context.params;
  const requestedUsername = rawUsername.trim().toLowerCase();

  if (!isValidUsername(requestedUsername)) {
    finishLog({ username: requestedUsername, status: 400, source: "none", cache: "none" });
    return Response.json(
      { error: "Enter a valid GitHub username (1–39 letters, numbers, or hyphens)." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const clientIp = clientIpFromRequest(request);
  const rateRule = gardenApiRateLimit();
  const rate = checkRateLimit(`garden-api:${clientIp}`, rateRule);
  if (!rate.allowed) {
    finishLog({
      username: requestedUsername,
      status: 429,
      source: "none",
      cache: "none",
      rateLimited: true,
    });
    return Response.json(
      { error: "Too many gardens requested in a short time. Pause a moment and try again." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rate.retryAfterSeconds),
        },
      },
    );
  }

  if (request.headers.has("authorization")) {
    finishLog({ username: requestedUsername, status: 400, source: "none", cache: "none" });
    return Response.json(
      {
        error:
          "Browser credentials are not accepted. GitHub access is handled privately by the server.",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Cookie, Accept-Encoding",
        },
      },
    );
  }

  const sessionResolution = await resolveGitHubSession(request);
  if (!sessionResolution.session && sessionResolution.invalid) {
    finishLog({ username: requestedUsername, status: 401, source: "session", cache: "none" });
    return Response.json(
      { error: "Your GitHub session expired. Sign in again." },
      {
        status: 401,
        headers: responseHeaders(
          SESSION_LIVE_CACHE_HEADERS,
          sessionResolution.setCookie,
        ),
      },
    );
  }

  const session = sessionResolution.session;
  const serverAuthorization = githubServerAuthorization();
  if (!session && serverAuthorization.incomplete) {
    finishLog({ username: requestedUsername, status: 503, source: "none", cache: "none" });
    return Response.json(
      { error: "The server's GitHub connection is not configured yet." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  const viewerRequested =
    new URL(request.url).searchParams.get("viewer") === "true";

  // A signed-in visitor's personal token is reserved for their own garden
  // (viewer=true, which may include private contributions). Browsing other
  // public profiles uses the shared server credential and its cache instead of
  // burning the visitor's personal GitHub rate limit.
  const useSessionToken =
    Boolean(session) && (viewerRequested || !serverAuthorization.credential);
  const authorization: GitHubAuthorization | null = useSessionToken && session
    ? {
        header: `Bearer ${session.accessToken}`,
        kind: "user-session",
        cacheScope: `user-session:${session.login.toLowerCase()}`,
      }
    : serverAuthorization.credential;

  if (viewerRequested && !session) {
    finishLog({ username: requestedUsername, status: 401, source: "session", cache: "none" });
    return Response.json(
      { error: "Sign in with GitHub to open your own garden." },
      {
        status: 401,
        headers: responseHeaders(
          SESSION_LIVE_CACHE_HEADERS,
          sessionResolution.setCookie,
        ),
      },
    );
  }
  if (!authorization) {
    finishLog({
      username: requestedUsername,
      status: 200,
      source: "demo",
      cache: "miss",
    });
    return Response.json(createMockGitHubData(requestedUsername), {
      headers: DEMO_CACHE_HEADERS,
    });
  }

  const username = viewerRequested && session
    ? session.login.toLowerCase()
    : requestedUsername;
  try {
    const result = useSessionToken
      ? {
          data: await loadGitHubGarden(username, authorization),
          cacheStatus: "miss" as const,
        }
      : await loadPublicGitHubGarden(username, authorization);
    finishLog({
      username,
      status: 200,
      source: result.data.source,
      cache: result.cacheStatus,
      session: useSessionToken,
    });
    let headers = useSessionToken
      ? responseHeaders(
          SESSION_LIVE_CACHE_HEADERS,
          sessionResolution.setCookie,
        )
      : publicLiveHeaders(result.cacheStatus);
    if (!useSessionToken && session && sessionResolution.setCookie) {
      // The visitor's tokens were rotated during this request. Deliver the
      // refreshed cookie, but never through a shared-cacheable response.
      headers = responseHeaders(
        SESSION_LIVE_CACHE_HEADERS,
        sessionResolution.setCookie,
      );
    }
    return Response.json(result.data, { headers });
  } catch (error) {
    if (useSessionToken && session) {
      const status = error instanceof GitHubRequestError ? error.status : 502;
      if (status === 401) {
        try {
          const refreshed = await forceRefreshGitHubSession(session, request);
          if (refreshed.session) {
            const data = await loadGitHubGarden(
              viewerRequested ? refreshed.session.login : username,
              {
                header: `Bearer ${refreshed.session.accessToken}`,
                kind: "user-session",
                cacheScope: `user-session:${refreshed.session.login.toLowerCase()}`,
              },
            );
            finishLog({
              username,
              status: 200,
              source: "github",
              cache: "refreshed-session",
            });
            return Response.json(data, {
              headers: responseHeaders(
                SESSION_LIVE_CACHE_HEADERS,
                refreshed.setCookie,
              ),
            });
          }
        } catch (refreshError) {
          logger.warn("garden_session_refresh_failed", {
            username,
            detail: refreshError instanceof Error ? refreshError.name : "unknown",
          });
        }

        finishLog({ username, status: 401, source: "session", cache: "none" });
        return Response.json(
          { error: "Your GitHub session expired. Sign in again." },
          {
            status: 401,
            headers: responseHeaders(
              SESSION_LIVE_CACHE_HEADERS,
              serializeClearGitHubSessionCookie(request),
            ),
          },
        );
      }

      const message =
        status === 404
          ? `GitHub could not find @${username}. Your account is still connected.`
          : status === 429
            ? "GitHub's API limit was reached. Your account is still connected; try again shortly."
            : "GitHub is temporarily unavailable. Your account is still connected.";
      finishLog({ username, status, source: "github", cache: "none" });
      const sessionErrorHeaders = responseHeaders(
        SESSION_LIVE_CACHE_HEADERS,
        sessionResolution.setCookie,
      );
      if (status === 429) {
        sessionErrorHeaders.set("Retry-After", "30");
      }
      return Response.json(
        { error: message },
        { status, headers: sessionErrorHeaders },
      );
    }

    const status = error instanceof GitHubRequestError ? error.status : 502;
    const responseStatus = status === 401 ? 503 : status;
    logger.warn("garden_public_load_failed", {
      username,
      upstreamStatus: status,
      responseStatus,
    });
    const message =
      status === 404
        ? `GitHub could not find @${username}.`
        : status === 429
          ? "GitHub's API limit was reached. Try this garden again shortly."
          : status === 401
            ? "The private server connection was rejected by GitHub."
            : "GitHub is temporarily unavailable. Try this garden again shortly.";
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Contribution-Garden-Source": "github",
    });
    if (responseStatus === 429) {
      headers.set("Retry-After", "30");
    }
    finishLog({
      username,
      status: responseStatus,
      source: "github",
      cache: "none",
    });
    return Response.json(
      { error: message },
      { status: responseStatus, headers },
    );
  }
}
