import assert from "node:assert/strict";
import test from "node:test";

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const workerModule = await import(workerUrl.href);
  return workerModule.default;
}

const environment = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

function assertNoStore(response) {
  assert.match(response.headers.get("cache-control") ?? "", /\bno-store\b/i);
}

function assertNoExternalRedirect(response) {
  const location = response.headers.get("location");
  if (!location) return;
  const target = new URL(location, "http://localhost");
  assert.equal(target.origin, "http://localhost");
}

function setTestEnvironment(values) {
  const previous = new Map();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}

function responseSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

function cookiePair(setCookie) {
  return setCookie.slice(0, setCookie.indexOf(";"));
}

test("server-renders the Contribution Garden shell", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    environment,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Contribution Garden/);
  assert.match(html, /A living GitHub and GitLab ecosystem/i);
  assert.match(html, /Enter the garden/i);
  assert.match(html, /garden-hero-v4-voxel\.webp/);
  assert.match(html, /og-v2\.png/);
  assert.doesNotMatch(html, /data-contribution-garden/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
  assert.doesNotMatch(
    html,
    /Set up GitHub|Connect your GitHub|Continue with GitHub/i,
  );
});

test("serves the disconnected browser path without an Authorization header", async () => {
  const app = await worker();
  const request = new Request("http://localhost/api/github/octocat", {
    headers: { accept: "application/json" },
  });
  assert.equal(request.headers.has("authorization"), false);

  const response = await app.fetch(
    request,
    environment,
    context,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-contribution-garden-source"), "demo");
  assert.match(response.headers.get("vary") ?? "", /accept-encoding/i);
  assert.doesNotMatch(response.headers.get("vary") ?? "", /authorization/i);

  const data = await response.json();
  assert.equal(data.source, "demo");
  assert.equal(data.profile.login, "octocat");
  assert.ok(data.calendar.length >= 365 * 5);
  assert.ok(data.metrics.totalContributions > 1_000);
  assert.ok(data.languages.length >= 4);
  assert.ok(data.repositories.length >= 8);
});

test("loads and caches a public GitLab garden through the normalized contract", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setTestEnvironment({
    GITLAB_BASE_URL: "https://gitlab.test",
    GITLAB_TOKEN: undefined,
  });
  const today = new Date().toISOString().slice(0, 10);
  let calls = 0;

  globalThis.fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.includes("/api/v4/users?")) {
      return Response.json([
        {
          id: 42,
          username: "garden.user",
          name: "GitLab Garden",
          avatar_url: "https://gitlab.test/avatar.png",
          web_url: "https://gitlab.test/garden.user",
        },
      ]);
    }
    if (url.includes("/api/v4/users/42/projects?")) {
      return Response.json([
        {
          id: 7,
          name: "seedling",
          name_with_namespace: "Garden Garden / seedling",
          path_with_namespace: "garden.user/seedling",
          web_url: "https://gitlab.test/garden.user/seedling",
          description: "A small project.",
          star_count: 4,
          forks_count: 1,
          archived: false,
          last_activity_at: "2026-09-20T12:00:00.000Z",
        },
      ]);
    }
    if (url.includes("/users/garden.user/calendar.json")) {
      return Response.json({ [today]: 6 });
    }
    if (url.includes("/api/v4/projects/7/languages")) {
      return Response.json({ TypeScript: 70, CSS: 30 });
    }
    throw new Error(`Unexpected GitLab request: ${url}`);
  };

  try {
    const app = await worker();
    const request = () =>
      new Request("http://localhost/api/gitlab/garden.user", {
        headers: { accept: "application/json" },
      });
    const firstResponse = await app.fetch(request(), environment, context);
    assert.equal(firstResponse.status, 200);
    assert.equal(firstResponse.headers.get("x-contribution-garden-source"), "gitlab");
    assert.equal(firstResponse.headers.get("x-contribution-garden-cache"), "miss");

    const firstData = await firstResponse.json();
    assert.equal(firstData.source, "gitlab");
    assert.equal(firstData.profile.login, "garden.user");
    assert.equal(firstData.metrics.totalContributions, 6);
    assert.equal(firstData.repositories[0].name, "seedling");
    assert.equal(firstData.languages[0].name, "TypeScript");
    assert.equal(firstData.calendar.length, 365);

    const secondResponse = await app.fetch(request(), environment, context);
    assert.equal(secondResponse.status, 200);
    assert.equal(secondResponse.headers.get("x-contribution-garden-cache"), "hit");
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test("loads and caches public gardens with one server-side OAuth App credential", async () => {
  const originalFetch = globalThis.fetch;
  const clientId = "garden-oauth-client";
  const clientSecret = "garden-oauth-secret";
  const restoreEnvironment = setTestEnvironment({
    GITHUB_OAUTH_CLIENT_ID: clientId,
    GITHUB_OAUTH_CLIENT_SECRET: clientSecret,
    GITHUB_TOKEN: undefined,
  });
  const year = new Date().getUTCFullYear();
  const contributionDate = `${year}-01-02`;
  let graphQLCalls = 0;

  globalThis.fetch = async (_input, init) => {
    graphQLCalls += 1;
    const authorization = new Headers(init?.headers).get("authorization");
    assert.match(authorization ?? "", /^Basic /);
    assert.equal(
      Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8"),
      `${clientId}:${clientSecret}`,
    );

    const body = JSON.parse(String(init?.body ?? "{}"));
    const query = String(body.query ?? "");
    if (query.includes("ContributionGardenProfile")) {
      return Response.json({
        data: {
          user: {
            login: "oauth-app-garden",
            name: "OAuth App Garden",
            bio: "",
            avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
            url: "https://github.com/oauth-app-garden",
            location: null,
            company: null,
            websiteUrl: null,
            createdAt: "2020-01-01T00:00:00Z",
            followers: { totalCount: 12 },
            following: { totalCount: 4 },
            repositories: {
              totalCount: 0,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [],
            },
            contributionsCollection: {
              contributionYears: [year],
              totalCommitContributions: 3_000,
              totalIssueContributions: 120,
              totalPullRequestContributions: 410,
              totalPullRequestReviewContributions: 230,
              contributionCalendar: { totalContributions: 4_081 },
            },
          },
        },
      });
    }

    if (query.includes("ContributionGardenHistory")) {
      const collection = {
        totalCommitContributions: 3_000,
        totalIssueContributions: 120,
        totalPullRequestContributions: 410,
        totalPullRequestReviewContributions: 230,
        restrictedContributionsCount: 0,
        contributionCalendar: {
          totalContributions: 4_081,
          weeks: [
            {
              contributionDays: [
                {
                  date: contributionDate,
                  weekday: new Date(`${contributionDate}T00:00:00Z`).getUTCDay(),
                  contributionCount: 7,
                  contributionLevel: "THIRD_QUARTILE",
                  color: "#30a14e",
                },
              ],
            },
          ],
        },
        commitContributionsByRepository: [],
      };
      const aliases = [...query.matchAll(/y(\d{4}): contributionsCollection/g)];
      return Response.json({
        data: {
          user: Object.fromEntries(
            aliases.map((match) => [`y${match[1]}`, collection]),
          ),
        },
      });
    }

    throw new Error("Unexpected GitHub GraphQL test query");
  };

  try {
    const app = await worker();
    const request = () =>
      new Request("http://localhost/api/github/oauth-app-garden", {
        headers: { accept: "application/json" },
      });

    const firstResponse = await app.fetch(request(), environment, context);
    assert.equal(firstResponse.status, 200);
    assert.equal(firstResponse.headers.get("x-contribution-garden-source"), "github");
    assert.equal(firstResponse.headers.get("x-contribution-garden-cache"), "miss");
    assert.doesNotMatch(firstResponse.headers.get("vary") ?? "", /cookie|authorization/i);
    const firstBody = await firstResponse.text();
    assert.doesNotMatch(firstBody, new RegExp(`${clientId}|${clientSecret}`));
    const firstData = JSON.parse(firstBody);
    assert.equal(firstData.source, "github");
    assert.equal(firstData.metrics.totalContributions, 4_081);

    const secondResponse = await app.fetch(request(), environment, context);
    assert.equal(secondResponse.status, 200);
    assert.equal(secondResponse.headers.get("x-contribution-garden-cache"), "hit");
    assert.equal(graphQLCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test("maps a missing GitHub account to a not-found response", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setTestEnvironment({
    GITHUB_OAUTH_CLIENT_ID: "garden-oauth-client",
    GITHUB_OAUTH_CLIENT_SECRET: "garden-oauth-secret",
    GITHUB_TOKEN: undefined,
  });

  globalThis.fetch = async () =>
    Response.json({
      errors: [
        {
          type: "NOT_FOUND",
          message: "Could not resolve to a User with the login of missing-garden-user.",
        },
      ],
    });

  try {
    const app = await worker();
    const response = await app.fetch(
      new Request("http://localhost/api/github/missing-garden-user", {
        headers: { accept: "application/json" },
      }),
      environment,
      context,
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "GitHub could not find @missing-garden-user.",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test("reports a disconnected OAuth session when GitHub App OAuth is unconfigured", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/api/auth/github/session", {
      headers: { accept: "application/json" },
    }),
    environment,
    context,
  );

  assert.equal(response.status, 200);
  assertNoStore(response);
  const data = await response.json();
  assert.equal(data.configured, false);
  assert.equal(data.authenticated, false);
  assert.equal("account" in data, false);
  assert.equal("accessToken" in data, false);
  assert.equal("refreshToken" in data, false);
});

test("does not start OAuth without GitHub App configuration", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/api/auth/github/start", {
      headers: { accept: "application/json" },
      redirect: "manual",
    }),
    environment,
    context,
  );

  assert.equal(response.status, 503);
  assertNoStore(response);
  assertNoExternalRedirect(response);
  const body = await response.text();
  assert.doesNotMatch(body, /client_secret|access_token|refresh_token/i);
});

test("rejects an OAuth callback without a trusted state", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/api/auth/github/callback?code=untrusted-code", {
      redirect: "manual",
    }),
    environment,
    context,
  );

  assert.ok([400, 401, 503].includes(response.status));
  assertNoStore(response);
  assertNoExternalRedirect(response);
  const body = await response.text();
  assert.doesNotMatch(body, /untrusted-code/);
});

test("rejects mismatched OAuth state and sanitizes the return path", async () => {
  const restoreEnvironment = setTestEnvironment({
    GITHUB_APP_CLIENT_ID: "Iv1.contribution-garden-test",
    GITHUB_APP_CLIENT_SECRET: "test-client-secret",
    GITHUB_APP_CALLBACK_URL: "http://localhost/api/auth/github/callback",
    GITHUB_SESSION_SECRET:
      "test-session-secret-with-at-least-thirty-two-characters",
  });

  try {
    const app = await worker();
    const startResponse = await app.fetch(
      new Request(
        "http://localhost/api/auth/github/start?return_to=%2F%2Fevil.example%2Fgarden",
        { redirect: "manual" },
      ),
      environment,
      context,
    );
    const transactionCookie = responseSetCookies(startResponse).find((value) =>
      value.startsWith("cg_github_oauth="),
    );
    assert.ok(transactionCookie);

    const callbackResponse = await app.fetch(
      new Request(
        "http://localhost/api/auth/github/callback?code=untrusted-code&state=wrong-state",
        {
          headers: { cookie: cookiePair(transactionCookie) },
          redirect: "manual",
        },
      ),
      environment,
      context,
    );
    assert.equal(callbackResponse.status, 303);
    assertNoStore(callbackResponse);
    assert.equal(callbackResponse.headers.get("location"), "/?github=failed");
    assertNoExternalRedirect(callbackResponse);
    assert.doesNotMatch(await callbackResponse.text(), /untrusted-code/);
  } finally {
    restoreEnvironment();
  }
});

test("logout is idempotent without an OAuth session", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/api/auth/github/logout", {
      method: "POST",
      headers: {
        accept: "application/json",
        origin: "http://localhost",
      },
      redirect: "manual",
    }),
    environment,
    context,
  );

  assert.equal(response.status, 204);
  assertNoStore(response);
  assertNoExternalRedirect(response);
});

test("health endpoint reports liveness without secrets", async () => {
  const restoreEnvironment = setTestEnvironment({
    GITHUB_OAUTH_CLIENT_ID: undefined,
    GITHUB_OAUTH_CLIENT_SECRET: undefined,
    GITHUB_TOKEN: undefined,
    GITHUB_APP_CLIENT_ID: undefined,
    GITHUB_APP_CLIENT_SECRET: undefined,
  });
  try {
    const app = await worker();
    const response = await app.fetch(
      new Request("http://localhost/api/health"),
      environment,
      context,
    );

    assert.equal(response.status, 200);
    assertNoStore(response);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.service, "contribution-garden");
    assert.equal(data.liveGitHubData, false);
    assert.equal(data.visitorAuth, false);

    const rawBody = JSON.stringify(data);
    assert.doesNotMatch(rawBody, /secret|token|password/i);
  } finally {
    restoreEnvironment();
  }
});

test("applies baseline security headers to responses", async () => {
  const app = await worker();
  const htmlResponse = await app.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    environment,
    context,
  );
  assert.equal(htmlResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(htmlResponse.headers.get("x-frame-options"), "DENY");
  assert.match(
    htmlResponse.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.equal(
    htmlResponse.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  // Plain HTTP responses must not emit HSTS.
  assert.equal(htmlResponse.headers.get("strict-transport-security"), null);

  const jsonResponse = await app.fetch(
    new Request("http://localhost/api/github/octocat", {
      headers: { accept: "application/json" },
    }),
    environment,
    context,
  );
  assert.equal(jsonResponse.headers.get("x-frame-options"), "DENY");
});

test("rate limits excessive garden API requests per client", async () => {
  const restoreEnvironment = setTestEnvironment({
    GARDEN_API_RATE_LIMIT: "3",
  });
  try {
    const app = await worker();
    const request = () =>
      new Request("http://localhost/api/github/octocat", {
        headers: { accept: "application/json" },
      });

    const statuses = [];
    let limitedResponse = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.fetch(request(), environment, context);
      if (response.status === 429) {
        limitedResponse = response;
        break;
      }
      statuses.push(response.status);
      await response.text();
    }

    assert.deepEqual(statuses, [200, 200, 200]);
    assert.ok(limitedResponse, "expected the 4th request to be limited");
    assert.equal(limitedResponse.status, 429);
    assertNoStore(limitedResponse);
    const retryAfter = Number(limitedResponse.headers.get("retry-after"));
    assert.ok(Number.isFinite(retryAfter) && retryAfter >= 1);
    const body = await limitedResponse.json();
    assert.ok(body.error);
    assert.doesNotMatch(JSON.stringify(body), /client-id|secret/i);
  } finally {
    restoreEnvironment();
  }
});

test("completes GitHub App OAuth without exposing tokens and preserves the rolling-year total", async () => {
  const originalFetch = globalThis.fetch;
  const restoreEnvironment = setTestEnvironment({
    GITHUB_APP_CLIENT_ID: "Iv1.contribution-garden-test",
    GITHUB_APP_CLIENT_SECRET: "test-client-secret",
    GITHUB_APP_CALLBACK_URL: "http://localhost/api/auth/github/callback",
    GITHUB_SESSION_SECRET:
      "test-session-secret-with-at-least-thirty-two-characters",
    GITHUB_TOKEN: undefined,
  });
  const year = new Date().getUTCFullYear();
  const contributionDate = `${year}-01-02`;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://github.com/login/oauth/access_token") {
      return Response.json({
        access_token: `ghu_${"a".repeat(48)}`,
        expires_in: 28_800,
        refresh_token: `ghr_${"b".repeat(48)}`,
        refresh_token_expires_in: 15_552_000,
        token_type: "bearer",
      });
    }

    if (url === "https://api.github.com/user") {
      return Response.json({
        id: 1,
        login: "garden-user",
        name: "Garden User",
        avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
        html_url: "https://github.com/garden-user",
      });
    }

    const body = JSON.parse(String(init?.body ?? "{}"));
    const query = String(body.query ?? "");

    if (query.includes("ContributionGardenProfile")) {
      return Response.json({
        data: {
          user: {
            login: "garden-user",
            name: "Garden User",
            bio: "",
            avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
            url: "https://github.com/garden-user",
            location: null,
            company: null,
            websiteUrl: null,
            createdAt: "2020-01-01T00:00:00Z",
            followers: { totalCount: 12 },
            following: { totalCount: 4 },
            repositories: {
              totalCount: 1,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  name: "garden",
                  nameWithOwner: "garden-user/garden",
                  url: "https://github.com/garden-user/garden",
                  description: null,
                  stargazerCount: 5,
                  forkCount: 1,
                  isArchived: false,
                  updatedAt: `${year}-01-02T00:00:00Z`,
                  primaryLanguage: { name: "TypeScript", color: "#3178c6" },
                  languages: {
                    edges: [
                      {
                        size: 100,
                        node: { name: "TypeScript", color: "#3178c6" },
                      },
                    ],
                  },
                },
              ],
            },
            contributionsCollection: {
              contributionYears: [year],
              totalCommitContributions: 3_000,
              totalIssueContributions: 120,
              totalPullRequestContributions: 410,
              totalPullRequestReviewContributions: 230,
              contributionCalendar: { totalContributions: 4_081 },
            },
          },
        },
      });
    }

    if (query.includes("ContributionGardenHistory")) {
      const collection = {
        totalCommitContributions: 9_000,
        totalIssueContributions: 900,
        totalPullRequestContributions: 800,
        totalPullRequestReviewContributions: 700,
        restrictedContributionsCount: 0,
        contributionCalendar: {
          totalContributions: 12_345,
          weeks: [
            {
              contributionDays: [
                {
                  date: contributionDate,
                  weekday: new Date(`${contributionDate}T00:00:00Z`).getUTCDay(),
                  contributionCount: 7,
                  contributionLevel: "THIRD_QUARTILE",
                  color: "#30a14e",
                },
              ],
            },
          ],
        },
        commitContributionsByRepository: [],
      };
      const aliases = [...query.matchAll(/y(\d{4}): contributionsCollection/g)];
      return Response.json({
        data: {
          user: Object.fromEntries(
            aliases.map((match) => [`y${match[1]}`, collection]),
          ),
        },
      });
    }

    throw new Error("Unexpected GitHub GraphQL test query");
  };

  try {
    const app = await worker();

    const startResponse = await app.fetch(
      new Request(
        "http://localhost/api/auth/github/start?return_to=%2F%3Fuser%3Doctocat",
        { redirect: "manual" },
      ),
      environment,
      context,
    );
    assert.equal(startResponse.status, 302);
    assertNoStore(startResponse);
    const authorizeUrl = new URL(startResponse.headers.get("location"));
    assert.equal(authorizeUrl.origin, "https://github.com");
    assert.equal(authorizeUrl.pathname, "/login/oauth/authorize");
    assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authorizeUrl.searchParams.get("code_challenge"));
    const state = authorizeUrl.searchParams.get("state");
    assert.ok(state);
    const transactionCookie = responseSetCookies(startResponse).find((value) =>
      value.startsWith("cg_github_oauth="),
    );
    assert.ok(transactionCookie);
    assert.match(transactionCookie, /HttpOnly/i);
    assert.match(transactionCookie, /SameSite=Lax/i);

    const callbackResponse = await app.fetch(
      new Request(
        `http://localhost/api/auth/github/callback?code=trusted_code_123&state=${encodeURIComponent(state)}`,
        {
          headers: { cookie: cookiePair(transactionCookie) },
          redirect: "manual",
        },
      ),
      environment,
      context,
    );
    assert.equal(callbackResponse.status, 303);
    assertNoStore(callbackResponse);
    assert.equal(
      callbackResponse.headers.get("location"),
      "/?user=octocat&github=connected",
    );
    assert.doesNotMatch(callbackResponse.headers.get("location"), /ghu_|ghr_/);
    const sessionCookie = responseSetCookies(callbackResponse).find((value) =>
      value.startsWith("cg_github_session="),
    );
    assert.ok(sessionCookie);
    assert.match(sessionCookie, /HttpOnly/i);
    assert.doesNotMatch(sessionCookie, /ghu_|ghr_/);

    const sessionResponse = await app.fetch(
      new Request("http://localhost/api/auth/github/session", {
        headers: {
          accept: "application/json",
          cookie: cookiePair(sessionCookie),
        },
      }),
      environment,
      context,
    );
    assert.equal(sessionResponse.status, 200);
    assertNoStore(sessionResponse);
    const sessionData = await sessionResponse.json();
    assert.equal(sessionData.configured, true);
    assert.equal(sessionData.authenticated, true);
    assert.equal(sessionData.account.login, "garden-user");
    assert.equal(sessionData.account.name, "Garden User");
    assert.equal("accessToken" in sessionData, false);
    assert.equal("refreshToken" in sessionData, false);

    const response = await app.fetch(
      new Request("http://localhost/api/github/octocat?viewer=true", {
        headers: {
          accept: "application/json",
          cookie: cookiePair(sessionCookie),
        },
      }),
      environment,
      context,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("vary") ?? "", /cookie/i);
    const data = await response.json();
    assert.equal(data.profile.login, "garden-user");
    assert.equal(data.metrics.totalContributions, 4_081);
    assert.equal(data.metrics.commits, 3_000);
    assert.notEqual(data.metrics.totalContributions, 12_345);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});
