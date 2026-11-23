import assert from "node:assert/strict";
import test from "node:test";
import { GitHubRequestError } from "@/lib/github/graphql";
import { searchCandidates } from "@/lib/rankings/github-source";

function fakeSearch(byAlias: Record<string, Array<{ id: number; login: string }>>) {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.searchParams.get("q") ?? "");
    const alias = /location:"([^"]+)"/.exec(url.searchParams.get("q") ?? "")?.[1] ?? "";
    const page = Number(url.searchParams.get("page"));
    const perPage = Number(url.searchParams.get("per_page"));
    const items = (byAlias[alias] ?? []).slice((page - 1) * perPage, page * perPage);
    return Response.json({ total_count: byAlias[alias]?.length ?? 0, items });
  };
  return { calls, fetchImpl };
}

test("merges aliases round-robin, de-duplicates, and stops at the limit", async () => {
  const { calls, fetchImpl } = fakeSearch({
    Berlin: [{ id: 1, login: "b1" }, { id: 2, login: "b2" }, { id: 3, login: "b3" }],
    Germany: [{ id: 2, login: "b2" }, { id: 9, login: "g9" }],
  });
  const users = await searchCandidates(["Berlin", "Germany"], 4, {
    token: "t",
    fetchImpl,
    sleep: async () => {},
  });
  assert.deepEqual(users.map((u) => u.login), ["b1", "b2", "g9", "b3"]);
  assert.ok(calls.every((q) => q.includes("followers:>10") && q.includes("type:user")));
});

test("throttles between search requests", async () => {
  const { fetchImpl } = fakeSearch({ A: [{ id: 1, login: "a" }], B: [{ id: 2, login: "b" }] });
  const waits: number[] = [];
  await searchCandidates(["A", "B"], 10, {
    token: "t",
    fetchImpl,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.deepEqual(waits, [2100]);
});

test("fails loudly on an auth error", async () => {
  await assert.rejects(
    searchCandidates(["A"], 10, {
      token: "bad",
      fetchImpl: async () => new Response("{}", { status: 401 }),
      sleep: async () => {},
    }),
    /GitHub search failed with status 401/,
  );
});

test("retries after a secondary rate limit, honouring retry-after", async () => {
  let calls = 0;
  const waits: number[] = [];
  const users = await searchCandidates(["A"], 10, {
    token: "t",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("{}", { status: 403, headers: { "retry-after": "30" } });
      return Response.json({ items: [{ id: 1, login: "a" }] });
    },
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.ok(waits.includes(30_000));
  assert.deepEqual(users, [{ id: 1, login: "a" }]);
});

test("does not retry a 401 and raises a typed error", async () => {
  let calls = 0;
  await assert.rejects(
    searchCandidates(["A"], 10, {
      token: "bad",
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", { status: 401 });
      },
      sleep: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof GitHubRequestError);
      assert.equal(error.status, 401);
      assert.match(error.message, /GitHub search failed with status 401/);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("fetches a second page when the first is full", async () => {
  const all = Array.from({ length: 150 }, (_, index) => ({ id: index + 1, login: `u${index + 1}` }));
  const { calls, fetchImpl } = fakeSearch({ A: all });
  const users = await searchCandidates(["A"], 150, { token: "t", fetchImpl, sleep: async () => {} });
  assert.equal(calls.length, 2);
  assert.equal(users.length, 150);
});
