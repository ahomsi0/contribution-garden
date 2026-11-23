import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { GitHubRequestError, fetchGraphQL } from "@/lib/github/graphql";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const auth = { header: "Bearer t", kind: "rankings" as const, cacheScope: "x" };

function stub(response: () => Response) {
  globalThis.fetch = (async () => response()) as typeof fetch;
}

test("403 with retry-after maps to 429 and carries the wait", async () => {
  stub(() => new Response("{}", { status: 403, headers: { "retry-after": "30", "x-ratelimit-remaining": "4000" } }));
  await assert.rejects(fetchGraphQL(auth, "q", {}), (error: unknown) => {
    assert.ok(error instanceof GitHubRequestError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, 30);
    return true;
  });
});

test("403 with an exhausted quota maps to 429 without a wait hint", async () => {
  stub(() => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
  await assert.rejects(fetchGraphQL(auth, "q", {}), (error: unknown) => {
    assert.ok(error instanceof GitHubRequestError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, undefined);
    return true;
  });
});

test("a plain 403 maps to 502", async () => {
  stub(() => new Response("{}", { status: 403 }));
  await assert.rejects(fetchGraphQL(auth, "q", {}), (error: unknown) => {
    assert.ok(error instanceof GitHubRequestError);
    assert.equal(error.status, 502);
    return true;
  });
});

test("a 200 resolves to the data payload", async () => {
  stub(() => Response.json({ data: { ok: 1 } }));
  assert.deepEqual(await fetchGraphQL(auth, "q", {}), { ok: 1 });
});
