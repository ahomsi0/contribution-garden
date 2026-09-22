import {
  contributionLevelFromCount,
  deriveCalendarMetrics,
  type ContributionDay,
  type GitHubGardenData,
  type GitHubLanguage,
  type GitHubRepository,
} from "@/lib/github-types";
import { logger } from "@/lib/logger";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PROJECT_PAGES = 10;
const MAX_PROJECTS = 24;
const PROJECT_LANGUAGE_CONCURRENCY = 4;
const PUBLIC_GARDEN_CACHE_TTL_MS = 30 * 60 * 1_000;
const PUBLIC_GARDEN_STALE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_PUBLIC_GARDEN_CACHE_ENTRIES = 24;
const NEGATIVE_CACHE_TTL_MS = 30_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
const DAY_IN_MS = 86_400_000;
const FALLBACK_COLOR = "#7a8b78";
const CALENDAR_COLORS = [
  "#e4ece2",
  "#b8d8b0",
  "#7fbb87",
  "#4f9465",
  "#2f704d",
] as const;
const LANGUAGE_COLORS: Record<string, string> = {
  C: "#555555",
  Clojure: "#db5855",
  CSS: "#663399",
  Go: "#375eab",
  HTML: "#e34c26",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  Kotlin: "#a97bff",
  Markdown: "#083fa1",
  PHP: "#4f5d95",
  Python: "#3572a5",
  Ruby: "#701516",
  Rust: "#dea584",
  Shell: "#89e051",
  Swift: "#f05138",
  TypeScript: "#3178c6",
};

const LIVE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=21600",
  Vary: "Accept-Encoding",
  "X-Contribution-Garden-Source": "gitlab",
};

class GitLabRequestError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 404 | 429 | 502,
  ) {
    super(message);
    this.name = "GitLabRequestError";
  }
}

interface GitLabConfig {
  origin: string;
  apiBase: string;
  token: string | null;
  cacheScope: string;
}

interface GitLabUser {
  id: number;
  username: string;
  name: string | null;
  avatar_url?: string | null;
  web_url: string;
}

interface GitLabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  path_with_namespace: string;
  web_url: string;
  description: string | null;
  star_count: number;
  forks_count: number;
  archived: boolean;
  last_activity_at: string;
}

interface GitLabLanguageResponse {
  [name: string]: number;
}

interface PublicGardenCacheEntry {
  data: GitHubGardenData;
  freshUntil: number;
  staleUntil: number;
}

interface PublicGardenFailure {
  error: GitLabRequestError;
  retryAt: number;
}

type PublicGardenCacheStatus = "hit" | "miss" | "stale";

const publicGardenCache = new Map<string, PublicGardenCacheEntry>();
const publicGardenLoads = new Map<string, Promise<GitHubGardenData>>();
const publicGardenFailures = new Map<string, PublicGardenFailure>();

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

function gitLabConfig(): GitLabConfig {
  const configuredOrigin = process.env.GITLAB_BASE_URL?.trim() || "https://gitlab.com";
  let parsed: URL;
  try {
    parsed = new URL(configuredOrigin);
  } catch {
    parsed = new URL("https://gitlab.com");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    parsed = new URL("https://gitlab.com");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  const origin = parsed.toString().replace(/\/$/, "");
  const token = process.env.GITLAB_TOKEN?.trim() || null;
  return {
    origin,
    apiBase: `${origin}/api/v4`,
    token,
    cacheScope: `${origin}:${token ? "server-token" : "public"}`,
  };
}

async function fetchGitLabJson<T>(
  config: GitLabConfig,
  url: string,
): Promise<T> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(config.token ? { "PRIVATE-TOKEN": config.token } : {}),
        "User-Agent": "Contribution-Garden",
      },
      redirect: "error",
      signal: abortController.signal,
    });

    if (!response.ok) {
      const status =
        response.status === 401
          ? 401
          : response.status === 404
            ? 404
            : response.status === 429
              ? 429
              : 502;
      logger.warn("gitlab_http_error", {
        upstreamStatus: response.status,
        mappedStatus: status,
      });
      throw new GitLabRequestError(
        `GitLab request failed with status ${response.status}.`,
        status,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new GitLabRequestError("GitLab returned invalid JSON.", 502);
    }
  } catch (error) {
    if (error instanceof GitLabRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GitLabRequestError("The GitLab request timed out.", 502);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await task(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function findGitLabUser(
  config: GitLabConfig,
  username: string,
): Promise<GitLabUser> {
  const params = new URLSearchParams({ username, per_page: "100" });
  const users = await fetchGitLabJson<GitLabUser[]>(
    config,
    `${config.apiBase}/users?${params.toString()}`,
  );
  const user = users.find(
    (candidate) => candidate.username.toLowerCase() === username,
  );
  if (!user) throw new GitLabRequestError("GitLab user was not found.", 404);
  return user;
}

async function fetchGitLabProjects(
  config: GitLabConfig,
  userId: number,
): Promise<{ projects: GitLabProject[]; truncated: boolean }> {
  const projects: GitLabProject[] = [];
  for (let page = 1; page <= MAX_PROJECT_PAGES; page += 1) {
    const params = new URLSearchParams({
      owned: "true",
      page: String(page),
      per_page: "100",
      sort: "desc",
      order_by: "star_count",
      visibility: "public",
    });
    const pageProjects = await fetchGitLabJson<GitLabProject[]>(
      config,
      `${config.apiBase}/users/${encodeURIComponent(String(userId))}/projects?${params.toString()}`,
    );
    projects.push(...pageProjects);
    if (pageProjects.length < 100) {
      return { projects, truncated: false };
    }
  }
  return { projects, truncated: true };
}

async function fetchProjectLanguages(
  config: GitLabConfig,
  projects: readonly GitLabProject[],
): Promise<GitHubLanguage[]> {
  const responses = await mapWithConcurrency(
    projects.slice(0, MAX_PROJECTS),
    PROJECT_LANGUAGE_CONCURRENCY,
    async (project) => {
      try {
        return await fetchGitLabJson<GitLabLanguageResponse>(
          config,
          `${config.apiBase}/projects/${encodeURIComponent(String(project.id))}/languages`,
        );
      } catch {
        return null;
      }
    },
  );
  const totals = new Map<string, number>();
  for (const response of responses) {
    if (!response) continue;
    for (const [name, percentage] of Object.entries(response)) {
      if (Number.isFinite(percentage) && percentage > 0) {
        totals.set(name, (totals.get(name) ?? 0) + percentage);
      }
    }
  }
  const totalPercentage = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return [...totals.entries()]
    .map(([name, percentage]) => ({
      name,
      color: LANGUAGE_COLORS[name] ?? FALLBACK_COLOR,
      bytes: Math.round((percentage / Math.max(1, totalPercentage)) * 100_000),
      percentage: Math.round((percentage / Math.max(1, totalPercentage)) * 1_000) / 10,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
}

function normalizeRepositories(
  projects: readonly GitLabProject[],
): GitHubRepository[] {
  return projects.slice(0, MAX_PROJECTS).map((project) => ({
    name: project.name,
    nameWithOwner: project.path_with_namespace,
    url: project.web_url,
    description: project.description,
    stars: project.star_count,
    forks: project.forks_count,
    primaryLanguage: null,
    primaryLanguageColor: FALLBACK_COLOR,
    updatedAt: project.last_activity_at,
    isArchived: project.archived,
  }));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeCalendar(
  rawCalendar: Record<string, unknown>,
  now: Date,
): ContributionDay[] {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(today.getTime() - 364 * DAY_IN_MS);
  const firstWeekday = start.getUTCDay();
  const calendar: ContributionDay[] = [];

  for (let index = 0; index < 365; index += 1) {
    const date = new Date(start.getTime() + index * DAY_IN_MS);
    const dateString = isoDate(date);
    const candidate = rawCalendar[dateString];
    const count =
      typeof candidate === "number" && Number.isFinite(candidate)
        ? Math.max(0, Math.round(candidate))
        : 0;
    const level = contributionLevelFromCount(count);
    calendar.push({
      date: dateString,
      count,
      level,
      weekday: date.getUTCDay(),
      week: Math.floor((index + firstWeekday) / 7),
      color: CALENDAR_COLORS[level],
      repositories: [],
    });
  }
  return calendar;
}

async function loadGitLabGarden(
  username: string,
  config: GitLabConfig,
): Promise<GitHubGardenData> {
  const startedAt = Date.now();
  const now = new Date();
  const user = await findGitLabUser(config, username);
  const [projectResult, rawCalendar] = await Promise.all([
    fetchGitLabProjects(config, user.id),
    fetchGitLabJson<Record<string, unknown>>(
      config,
      `${config.origin}/users/${encodeURIComponent(user.username)}/calendar.json`,
    ),
  ]);
  const projects = projectResult.projects;
  const [languages] = await Promise.all([
    fetchProjectLanguages(config, projects),
  ]);
  const calendar = normalizeCalendar(rawCalendar, now);
  const derived = deriveCalendarMetrics(calendar, now);
  const totalContributions = calendar.reduce((sum, day) => sum + day.count, 0);
  const stars = projects.reduce((sum, project) => sum + project.star_count, 0);

  logger.info("gitlab_garden_loaded", {
    login: user.username,
    durationMs: Date.now() - startedAt,
    projects: projects.length,
    truncatedProjects: projectResult.truncated,
  });

  return {
    profile: {
      login: user.username,
      name: user.name?.trim() || user.username,
      bio: "",
      avatarUrl: user.avatar_url ?? "",
      url: user.web_url,
      location: null,
      company: null,
      websiteUrl: null,
      joinedAt: null,
      followers: 0,
      following: 0,
      repositories: projects.length,
      stars,
    },
    metrics: {
      totalContributions,
      // GitLab's public calendar aggregates contribution events, so it does
      // not expose GitHub-style commit/MR/issue category totals here.
      commits: 0,
      pullRequests: 0,
      issues: 0,
      pullRequestReviews: 0,
      repositories: projects.length,
      stars,
      followers: 0,
      ...derived,
    },
    calendar,
    languages,
    repositories: normalizeRepositories(projects),
    contributionYears: [
      ...new Set(calendar.map((day) => Number(day.date.slice(0, 4)))),
    ].sort((a, b) => b - a),
    source: "gitlab",
    fetchedAt: now.toISOString(),
    notice: `${projectResult.truncated ? `Project and language totals cover the first ${MAX_PROJECT_PAGES * 100} public projects. ` : ""}GitLab's public calendar covers the most recent 12 months and aggregates activity events rather than separating commits, merge requests, and issues.`,
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
      ? `${cached.data.notice} Showing recently cached GitLab data while GitLab is unavailable.`
      : "Showing recently cached GitLab data while GitLab is unavailable.",
  };
}

async function loadPublicGitLabGarden(
  username: string,
  config: GitLabConfig,
): Promise<{ data: GitHubGardenData; cacheStatus: PublicGardenCacheStatus }> {
  const cacheKey = `${config.cacheScope}:${username}`;
  const cached = publicGardenCache.get(cacheKey);
  if (cached && cached.freshUntil > Date.now()) {
    publicGardenCache.delete(cacheKey);
    publicGardenCache.set(cacheKey, cached);
    return { data: cached.data, cacheStatus: "hit" };
  }

  let pending = publicGardenLoads.get(cacheKey);
  if (!pending) {
    const failure = publicGardenFailures.get(cacheKey);
    if (failure && failure.retryAt > Date.now()) {
      if (cached && cached.staleUntil > Date.now()) {
        return { data: staleCopy(cached), cacheStatus: "stale" };
      }
      throw failure.error;
    }

    pending = loadGitLabGarden(username, config).then(
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
          error instanceof GitLabRequestError
            ? error
            : new GitLabRequestError("The garden could not be loaded.", 502);
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
  return /^[a-z\d](?:[a-z\d._-]{0,253}[a-z\d])?$/i.test(username);
}

function publicLiveHeaders(cacheStatus: PublicGardenCacheStatus): Headers {
  const headers = new Headers(LIVE_CACHE_HEADERS);
  headers.set("X-Contribution-Garden-Cache", cacheStatus);
  return headers;
}

interface RouteContext {
  params: Promise<{ username: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const startedAt = Date.now();
  const finishLog = (
    outcome: Record<string, string | number | boolean | null>,
  ) =>
    logger.info("garden_api_request", {
      route: "/api/gitlab/[username]",
      durationMs: Date.now() - startedAt,
      ...outcome,
    });
  const { username: rawUsername } = await context.params;
  const username = rawUsername.trim().toLowerCase();

  if (!isValidUsername(username)) {
    finishLog({ username, status: 400, source: "none", cache: "none" });
    return Response.json(
      { error: "Enter a valid GitLab username." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const clientIp = clientIpFromRequest(request);
  const rate = checkRateLimit(
    `garden-api:${clientIp}`,
    gardenApiRateLimit(),
  );
  if (!rate.allowed) {
    finishLog({ username, status: 429, source: "none", cache: "none" });
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
    finishLog({ username, status: 400, source: "none", cache: "none" });
    return Response.json(
      { error: "Browser credentials are not accepted. GitLab access is handled privately by the server." },
      {
        status: 400,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Cookie, Accept-Encoding",
        },
      },
    );
  }

  const config = gitLabConfig();
  try {
    const result = await loadPublicGitLabGarden(username, config);
    finishLog({
      username,
      status: 200,
      source: result.data.source,
      cache: result.cacheStatus,
    });
    return Response.json(result.data, { headers: publicLiveHeaders(result.cacheStatus) });
  } catch (error) {
    const status = error instanceof GitLabRequestError ? error.status : 502;
    const responseStatus = status === 401 ? 503 : status;
    const message =
      status === 404
        ? `GitLab could not find @${username}.`
        : status === 429
          ? "GitLab's API limit was reached. Try this garden again shortly."
          : status === 401
            ? "The private server connection was rejected by GitLab."
            : "GitLab is temporarily unavailable. Try this garden again shortly.";
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Contribution-Garden-Source": "gitlab",
    });
    if (responseStatus === 429) headers.set("Retry-After", "30");
    finishLog({ username, status: responseStatus, source: "gitlab", cache: "none" });
    return Response.json({ error: message }, { status: responseStatus, headers });
  }
}
