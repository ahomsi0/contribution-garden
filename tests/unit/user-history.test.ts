import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { fetchUserHistory } from "@/lib/rankings/github-source";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function calendar(year: number, count: number) {
  return {
    contributionCalendar: {
      weeks: [{ contributionDays: [{ date: `${year}-03-04`, contributionCount: count }] }],
    },
  };
}

function stubGraphQL(contributionYears: number[], remaining = 4_000) {
  const queries: string[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const query = String(JSON.parse(String(init?.body)).query);
    queries.push(query);
    const years = [...query.matchAll(/y(\d{4}): contributionsCollection/g)].map((m) => Number(m[1]));
    return Response.json({
      data: {
        rateLimit: { remaining, resetAt: "2026-11-23T11:00:00Z" },
        user: {
          databaseId: 42,
          login: "Mia",
          name: "Mia S",
          avatarUrl: "https://a/42",
          location: "Berlin, Germany",
          contributionsCollection: { contributionYears },
          ...Object.fromEntries(years.map((y) => [`y${y}`, calendar(y, y - 2000)])),
        },
      },
    });
  }) as typeof fetch;
  return queries;
}

const now = new Date("2026-11-23T10:00:00.000Z");

test("new user: fetches the latest two years, then the rest in chunks of 8", async () => {
  const queries = stubGraphQL([2026, 2025, 2024, 2015, 2010]);
  const result = await fetchUserHistory("mia", null, now, { token: "t", sleep: async () => {} });
  assert.ok(result);
  assert.equal(result.id, 42);
  assert.equal(result.login, "Mia");
  assert.equal(result.location, "Berlin, Germany");
  assert.deepEqual(result.years.map((y) => y.year), [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert.equal(result.years.at(-1)?.months[2], 26);
  assert.equal(queries.length, 3);
});

test("known user: only the requested years", async () => {
  const queries = stubGraphQL([2026, 2025]);
  const result = await fetchUserHistory("mia", 2026, now, { token: "t", sleep: async () => {} });
  assert.deepEqual(result?.years.map((y) => y.year), [2026]);
  assert.equal(queries.length, 1);
});

test("returns null for a user that no longer exists", async () => {
  globalThis.fetch = (async () =>
    Response.json({ errors: [{ type: "NOT_FOUND", message: "Could not resolve to a User" }] })) as typeof fetch;
  assert.equal(await fetchUserHistory("gone", null, now, { token: "t", sleep: async () => {} }), null);
});

test("sleeps until reset when the rate limit runs low", async () => {
  stubGraphQL([2026], 150);
  const waits: number[] = [];
  await fetchUserHistory("mia", 2026, now, {
    token: "t",
    sleep: async (ms) => {
      waits.push(ms);
    },
    now: () => new Date("2026-11-23T10:59:00Z"),
  });
  assert.deepEqual(waits, [65_000]);
});
