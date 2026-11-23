import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { directoryStore } from "@/lib/rankings/snapshot-store";

test("directory store round-trips JSON and returns null for missing files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rankings-"));
  try {
    const store = directoryStore(dir);
    assert.equal(await store.read("rankings/germany.json"), null);
    await store.write("rankings/germany.json", { ok: true });
    assert.deepEqual(await store.read("rankings/germany.json"), { ok: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
