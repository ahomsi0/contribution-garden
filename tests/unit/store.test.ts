import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { clearRankingsCache, getCountrySnapshot, getRankingsIndex } from "@/lib/rankings/store";

const originalFetch = globalThis.fetch;
afterEach(() => {
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
