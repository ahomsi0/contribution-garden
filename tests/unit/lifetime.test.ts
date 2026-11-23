import assert from "node:assert/strict";
import test from "node:test";
import { lifetimeContributions } from "@/lib/github-types";

test("sums every calendar day", () => {
  assert.equal(
    lifetimeContributions([
      { count: 3 },
      { count: 0 },
      { count: 12 },
    ]),
    15,
  );
});

test("ignores negative or non-finite counts", () => {
  assert.equal(lifetimeContributions([{ count: -4 }, { count: Number.NaN }, { count: 2 }]), 2);
});
