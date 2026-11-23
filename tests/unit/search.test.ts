import assert from "node:assert/strict";
import test from "node:test";
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
