import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGardenHandle } from "@/lib/garden-provider";

test("unit runner resolves @/ imports", () => {
  assert.equal(normalizeGardenHandle("@Octocat", "github"), "octocat");
});
