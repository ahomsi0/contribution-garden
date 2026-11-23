import assert from "node:assert/strict";
import test from "node:test";
import { formatUpdated, isStale } from "@/lib/rankings/format";

const now = new Date("2026-11-23T12:00:00.000Z");

test("formats recent updates in minutes, hours, and days", () => {
  assert.equal(formatUpdated("2026-11-23T11:58:00.000Z", now), "updated just now");
  assert.equal(formatUpdated("2026-11-23T11:20:00.000Z", now), "updated 40 minutes ago");
  assert.equal(formatUpdated("2026-11-23T09:00:00.000Z", now), "updated 3 hours ago");
  assert.equal(formatUpdated("2026-11-23T11:00:00.000Z", now), "updated 1 hour ago");
  assert.equal(formatUpdated("2026-11-20T12:00:00.000Z", now), "updated 3 days ago");
});

test("isStale after 48 hours", () => {
  assert.equal(isStale("2026-11-21T13:00:00.000Z", now), false);
  assert.equal(isStale("2026-11-21T11:00:00.000Z", now), true);
});
