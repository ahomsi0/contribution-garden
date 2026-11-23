import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import { clearRankingsCache, getCountrySnapshot, getRankingsIndex } from "@/lib/rankings/store";

const originalFetch = globalThis.fetch;
afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = originalFetch;
  delete process.env.RANKINGS_BASE_URL;
  clearRankingsCache();
});

const snapshot = {
  version: 1,
  country: { slug: "germany", name: "Germany" },
  generatedAt: "2026-11-23T03:00:00.000Z",
  candidateCount: 0,
  users: [],
};

test("returns null when no base URL is configured", async () => {
  assert.equal(await getRankingsIndex(), null);
});

test("reads, validates, and caches a country snapshot", async () => {
  process.env.RANKINGS_BASE_URL = "https://blob.test/";
  let calls = 0;
  globalThis.fetch = (async (input: unknown) => {
    calls += 1;
    assert.equal(String(input), "https://blob.test/rankings/germany.json");
    return Response.json(snapshot);
  }) as typeof fetch;
  assert.equal((await getCountrySnapshot("germany"))?.country.name, "Germany");
  await getCountrySnapshot("germany");
  assert.equal(calls, 1);
});

test("treats 404 and invalid JSON shapes as missing", async () => {
  process.env.RANKINGS_BASE_URL = "https://blob.test";
  globalThis.fetch = (async (input: unknown) =>
    String(input).endsWith("france.json")
      ? new Response("nope", { status: 404 })
      : Response.json({ version: 9 })) as typeof fetch;
  assert.equal(await getCountrySnapshot("france"), null);
  assert.equal(await getCountrySnapshot("japan"), null);
});

test("network errors are treated as missing", async () => {
  process.env.RANKINGS_BASE_URL = "https://blob.test";
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  assert.equal(await getRankingsIndex(), null);
});

const TTL = 10 * 60_000;

test("keeps serving the last good snapshot when a later refresh fails", async () => {
  process.env.RANKINGS_BASE_URL = "https://blob.test";
  mock.timers.enable({ apis: ["Date"], now: 0 });
  let fail = false;
  globalThis.fetch = (async () =>
    fail ? new Response("boom", { status: 500 }) : Response.json(snapshot)) as typeof fetch;
  assert.equal((await getCountrySnapshot("germany"))?.country.name, "Germany");
  mock.timers.tick(TTL + 1);
  fail = true;
  assert.equal((await getCountrySnapshot("germany"))?.country.name, "Germany");
});

test("a cold error caches null for 30 seconds only", async () => {
  process.env.RANKINGS_BASE_URL = "https://blob.test";
  mock.timers.enable({ apis: ["Date"], now: 0 });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("boom", { status: 500 });
  }) as typeof fetch;
  assert.equal(await getCountrySnapshot("germany"), null);
  mock.timers.tick(29_000);
  assert.equal(await getCountrySnapshot("germany"), null);
  assert.equal(calls, 1);
  mock.timers.tick(2_000);
  assert.equal(await getCountrySnapshot("germany"), null);
  assert.equal(calls, 2);
});

test("concurrent cold reads share one fetch, and fetches carry a timeout signal", async () => {
  process.env.RANKINGS_BASE_URL = "https://blob.test";
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    calls += 1;
    signal = init?.signal;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json(snapshot);
  }) as typeof fetch;
  const [a, b] = await Promise.all([getCountrySnapshot("germany"), getCountrySnapshot("germany")]);
  assert.ok(a && b);
  assert.equal(calls, 1);
  assert.ok(signal instanceof AbortSignal);
});
