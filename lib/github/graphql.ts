import { logger } from "@/lib/logger";

export const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
export const REQUEST_TIMEOUT_MS = 15_000;

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string; type?: string }>;
}

export class GitHubRequestError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 404 | 429 | 502,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GitHubRequestError";
  }
}

export type GitHubAuthorizationKind = "oauth-app" | "server-token" | "user-session" | "rankings";

export interface GitHubAuthorization {
  header: string;
  kind: GitHubAuthorizationKind;
  cacheScope: string;
}

export async function fetchGraphQL<T>(
  authorization: GitHubAuthorization,
  query: string,
  variables: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);

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
      // A 403 carrying retry-after is GitHub's secondary rate limit signal.
      const retryAfterHeader = response.headers.get("retry-after");
      const parsedRetryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      const retryAfterSeconds =
        Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0 ? parsedRetryAfter : undefined;
      const rateLimited =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get("x-ratelimit-remaining") === "0" || retryAfterHeader !== null));
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
        retryAfterSeconds,
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

export async function mapWithConcurrency<T, R>(
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

export function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
