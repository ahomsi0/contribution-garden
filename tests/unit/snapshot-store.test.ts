import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { put } from "@vercel/blob";
import { blobStore, directoryStore } from "@/lib/rankings/snapshot-store";

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

const base = "https://mine.public.blob.vercel-storage.com";
const fakePut = (url: string, calls: unknown[] = []) =>
  (async (...args: unknown[]) => {
    calls.push(args);
    return { url };
  }) as unknown as typeof put;

test("blob store rejects a write that landed in a different store", async () => {
  const store = blobStore({ token: "t", baseUrl: base, putImpl: fakePut("https://other.public.blob.vercel-storage.com/rankings/x.json") });
  await assert.rejects(store.write("rankings/x.json", {}), /Blob store mismatch/);
});

test("blob store accepts a write whose origin matches and passes the expected options", async () => {
  const calls: unknown[][] = [];
  const store = blobStore({ token: "t", baseUrl: `${base}/`, putImpl: fakePut(`${base}/rankings/x.json`, calls) });
  await store.write("rankings/x.json", { ok: true });
  const options = calls[0][2] as Record<string, unknown>;
  assert.equal(options.access, "public");
  assert.equal(options.addRandomSuffix, false);
  assert.equal(options.allowOverwrite, true);
  assert.equal(options.cacheControlMaxAge, 300);
});
