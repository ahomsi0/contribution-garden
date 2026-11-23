import assert from "node:assert/strict";
import test from "node:test";
import { buildCountry, orderCountriesByStaleness } from "@/lib/rankings/build";
import type { FetchedUser } from "@/lib/rankings/github-source";
import { isCountrySnapshot, type CountrySnapshot, type RankingsIndex } from "@/lib/rankings/snapshot";
import type { SnapshotStore } from "@/lib/rankings/snapshot-store";

function memoryStore(initial: Record<string, unknown> = {}): SnapshotStore & { files: Record<string, unknown> } {
  const files = { ...initial };
  return {
    files,
    async read(p) {
      return files[p] ?? null;
    },
    async write(p, data) {
      files[p] = data;
    },
  };
}

const months = (value: number) => Array.from({ length: 12 }, () => value);
const germany = { slug: "germany", name: "Germany", names: ["Germany"], cities: ["Berlin"] };
const now = new Date("2026-11-23T03:00:00.000Z");

test("builds ranked public and candidate snapshots", async () => {
  const store = memoryStore();
  const fetched: Record<string, FetchedUser | null> = {
    small: { id: 1, login: "small", name: null, avatarUrl: "https://a.test/avatar", location: "Berlin", years: [{ year: 2026, months: months(1) }] },
    big: { id: 2, login: "big", name: "Big", avatarUrl: "https://b.test/avatar", location: null, years: [{ year: 2026, months: months(10) }] },
    gone: null,
  };
  const snapshot = await buildCountry(germany, {
    store,
    now,
    candidateLimit: 10,
    publicLimit: 1,
    search: async () => [
      { id: 1, login: "small" },
      { id: 2, login: "big" },
      { id: 3, login: "gone" },
    ],
    fetchUser: async (login) => fetched[login],
    log: () => {},
  });
  assert.equal(isCountrySnapshot(snapshot), true);
  assert.deepEqual(snapshot.users.map((u) => [u.login, u.rank, u.score]), [["big", 1, 120]]);
  const candidates = store.files["rankings/germany.candidates.json"] as CountrySnapshot;
  assert.equal(candidates.users.length, 2);
  assert.equal(snapshot.candidateCount, 2);
  assert.ok(store.files["rankings/germany.json"]);
});

test("refuses to write a snapshot that fails validation", async () => {
  const store = memoryStore();
  await assert.rejects(
    buildCountry(germany, {
      store,
      now,
      candidateLimit: 10,
      publicLimit: 10,
      search: async () => [{ id: 1, login: "bad" }],
      fetchUser: async () => ({ id: 1, login: "bad", name: null, avatarUrl: "not-https", location: null, years: [{ year: 2026, months: months(1) }] }),
      log: () => {},
    }),
    /failed validation/,
  );
  assert.deepEqual(store.files, {});
});

test("reuses stored past years for known users", async () => {
  const previous: CountrySnapshot = {
    version: 1,
    country: { slug: "germany", name: "Germany" },
    generatedAt: "2026-11-22T03:00:00.000Z",
    candidateCount: 1,
    users: [{ rank: 1, id: 7, login: "old", name: null, avatarUrl: "https://x.test/avatar", score: 0, years: [{ year: 2020, months: months(5) }] }],
  };
  const store = memoryStore({ "rankings/germany.candidates.json": previous });
  const requested: Array<number | null> = [];
  const snapshot = await buildCountry(germany, {
    store,
    now,
    candidateLimit: 10,
    publicLimit: 10,
    search: async () => [{ id: 7, login: "old" }],
    fetchUser: async (_login, fromYear) => {
      requested.push(fromYear);
      return { id: 7, login: "old", name: null, avatarUrl: "https://x.test/avatar", location: null, years: [{ year: 2026, months: months(1) }] };
    },
    log: () => {},
  });
  assert.deepEqual(requested, [2026]);
  assert.deepEqual(snapshot.users[0].years.map((y) => y.year), [2020, 2026]);
  assert.equal(snapshot.users[0].score, 72);
});

test("excludes people whose location names another configured country", async () => {
  const store = memoryStore();
  const snapshot = await buildCountry(germany, {
    store,
    now,
    candidateLimit: 10,
    publicLimit: 10,
    search: async () => [
      { id: 1, login: "local" },
      { id: 2, login: "nh" },
    ],
    fetchUser: async (login) => ({
      id: login === "local" ? 1 : 2,
      login,
      name: null,
      avatarUrl: "https://x.test/avatar",
      location: login === "local" ? "Berlin, Germany" : "Berlin, NH, USA",
      years: [{ year: 2026, months: months(1) }],
    }),
    log: () => {},
  });
  assert.deepEqual(snapshot.users.map((u) => u.login), ["local"]);
});

test("a single failing user is skipped, an auth failure aborts", async () => {
  const store = memoryStore();
  const base = {
    store,
    now,
    candidateLimit: 10,
    publicLimit: 10,
    search: async () => [{ id: 1, login: "boom" }, { id: 2, login: "fine" }],
    log: () => {},
  };
  const skipped = await buildCountry(germany, {
    ...base,
    fetchUser: async (login) => {
      if (login === "boom") throw new Error("weird");
      return { id: 2, login, name: null, avatarUrl: "https://x.test/avatar", location: null, years: [{ year: 2026, months: months(1) }] };
    },
  });
  assert.deepEqual(skipped.users.map((u) => u.login), ["fine"]);
  const authError = Object.assign(new Error("bad credentials"), { status: 401 });
  await assert.rejects(buildCountry(germany, { ...base, fetchUser: async () => { throw authError; } }), /bad credentials/);
});

test("fails the country when too many candidates error", async () => {
  const store = memoryStore();
  const candidates = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, login: `u${i + 1}` }));
  await assert.rejects(
    buildCountry(germany, {
      store,
      now,
      candidateLimit: 10,
      publicLimit: 10,
      search: async () => candidates,
      fetchUser: async () => {
        throw new Error("flaky");
      },
      log: () => {},
    }),
    /\d+ of 10 candidates failed/,
  );
  assert.equal(store.files["rankings/germany.json"], undefined, "nothing published");
});

const previousUser = (id: number) => ({
  rank: id,
  id,
  login: `u${id}`,
  name: null,
  avatarUrl: "https://x.test/avatar",
  score: 60,
  years: [{ year: 2020, months: months(5) }],
});
const previousBoard = (count: number): CountrySnapshot => ({
  version: 1,
  country: { slug: "germany", name: "Germany" },
  generatedAt: "2026-11-22T03:00:00.000Z",
  candidateCount: count,
  users: Array.from({ length: count }, (_, i) => previousUser(i + 1)),
});

test("refuses to publish an empty board", async () => {
  const store = memoryStore();
  await assert.rejects(
    buildCountry(germany, { store, now, candidateLimit: 10, publicLimit: 10, search: async () => [], fetchUser: async () => null, log: () => {} }),
    /no users ranked/,
  );
  assert.deepEqual(store.files, {});
});

test("refuses to publish a board that lost more than half its users", async () => {
  const previous = previousBoard(10);
  const store = memoryStore({ "rankings/germany.candidates.json": previous });
  const files = { ...store.files };
  await assert.rejects(
    buildCountry(germany, {
      store,
      now,
      candidateLimit: 10,
      publicLimit: 10,
      search: async () => previous.users.map((u) => ({ id: u.id, login: u.login })),
      fetchUser: async (login) => {
        const id = Number(login.slice(1));
        if (id <= 6) return null;
        return { id, login, name: null, avatarUrl: "https://x.test/avatar", location: null, years: [{ year: 2026, months: months(1) }] };
      },
      log: () => {},
    }),
    /shrank from 10 to 4/,
  );
  assert.deepEqual(store.files, files);
});

test("keeps a known user's previous data through a transient error", async () => {
  const previous: CountrySnapshot = { ...previousBoard(1), users: [{ ...previousUser(7), login: "old" }] };
  const store = memoryStore({ "rankings/germany.candidates.json": previous });
  const logs: string[] = [];
  const snapshot = await buildCountry(germany, {
    store,
    now,
    candidateLimit: 10,
    publicLimit: 10,
    search: async () => [{ id: 7, login: "old" }],
    fetchUser: async () => {
      throw new Error("flaky");
    },
    log: (m) => logs.push(m),
  });
  assert.equal(snapshot.users.length, 1);
  assert.equal(snapshot.users[0].id, 7);
  assert.equal(snapshot.users[0].score, 60);
  assert.deepEqual(snapshot.users[0].years, [{ year: 2020, months: months(5) }]);
  assert.ok(logs.some((m) => m.includes("kept previous data for old")));
});

test("a fatal error stops the other workers from starting new users", async () => {
  const candidates = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, login: `u${i + 1}` }));
  let calls = 0;
  await assert.rejects(
    buildCountry(germany, {
      store: memoryStore(),
      now,
      candidateLimit: 20,
      publicLimit: 20,
      concurrency: 4,
      search: async () => candidates,
      fetchUser: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("bad credentials"), { status: 401 });
        await new Promise((r) => setTimeout(r, 5));
        return null;
      },
      log: () => {},
    }),
    /bad credentials/,
  );
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(calls <= 7, `expected at most 7 fetchUser calls, got ${calls}`);
});

test("orders countries never built first, then oldest", () => {
  const index: RankingsIndex = {
    version: 1,
    generatedAt: "x",
    countries: [
      { slug: "a", name: "A", updatedAt: "2026-11-22T00:00:00Z", userCount: 1, leader: null },
      { slug: "b", name: "B", updatedAt: "2026-11-20T00:00:00Z", userCount: 1, leader: null },
    ],
  };
  const order = orderCountriesByStaleness(
    [
      { slug: "a", name: "A", names: [], cities: [] },
      { slug: "b", name: "B", names: [], cities: [] },
      { slug: "c", name: "C", names: [], cities: [] },
    ],
    index,
  );
  assert.deepEqual(order.map((c) => c.slug), ["c", "b", "a"]);
});
