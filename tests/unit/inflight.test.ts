import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import { createInflight } from "@/lib/inflight";

afterEach(() => {
  mock.timers.reset();
});

test("concurrent calls with the same key share one start()", async () => {
  const inflight = createInflight<number>(1_000);
  let starts = 0;
  const start = () => {
    starts += 1;
    return new Promise<number>((resolve) => setTimeout(() => resolve(7), 5));
  };
  const [a, b] = await Promise.all([inflight.run("k", start), inflight.run("k", start)]);
  assert.equal(starts, 1);
  assert.equal(a, 7);
  assert.equal(b, 7);
});

test("after the promise resolves the next call starts fresh", async () => {
  const inflight = createInflight<number>(1_000);
  let starts = 0;
  const start = async () => ++starts;
  assert.equal(await inflight.run("k", start), 1);
  assert.equal(inflight.size(), 0);
  assert.equal(await inflight.run("k", start), 2);
});

test("a never-settling promise times out waiters and is replaced once stale", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let clock = 0;
  const inflight = createInflight<string>(1_000, () => clock);
  let starts = 0;
  const stuck = () => {
    starts += 1;
    return new Promise<string>(() => {});
  };

  const first = inflight.run("k", stuck);
  const firstResult = assert.rejects(first, /in-flight request timed out/);
  clock = 400;
  const second = inflight.run("k", stuck);
  assert.equal(starts, 1);
  const secondResult = assert.rejects(second, /in-flight request timed out/);

  clock = 1_000;
  mock.timers.tick(1_000);
  await firstResult;
  await secondResult;
  assert.equal(inflight.size(), 0);

  const third = await inflight.run("k", async () => {
    starts += 1;
    return "fresh";
  });
  assert.equal(third, "fresh");
  assert.equal(starts, 2);
});

test("a stale stuck entry is replaced by a new start() even before its timer fires", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let clock = 0;
  const inflight = createInflight<string>(1_000, () => clock);
  let starts = 0;
  const stuck = new Promise<string>(() => {});
  void inflight.run("k", () => (starts++, stuck)).catch(() => {});
  clock = 1_500;
  const result = await inflight.run("k", async () => (starts++, "ok"));
  assert.equal(result, "ok");
  assert.equal(starts, 2);
});

test("a rejection propagates to all waiters and clears the entry", async () => {
  const inflight = createInflight<number>(1_000);
  let starts = 0;
  const start = () => {
    starts += 1;
    return new Promise<number>((_, reject) => setTimeout(() => reject(new Error("boom")), 5));
  };
  const results = await Promise.allSettled([inflight.run("k", start), inflight.run("k", start)]);
  assert.equal(starts, 1);
  for (const r of results) {
    assert.equal(r.status, "rejected");
    assert.equal((r as PromiseRejectedResult).reason.message, "boom");
  }
  assert.equal(inflight.size(), 0);
});
