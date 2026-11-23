import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIndex,
  isCountrySnapshot,
  isRankingsIndex,
  type CountrySnapshot,
  type RankingsIndex,
} from "@/lib/rankings/snapshot";

const months = Array.from({ length: 12 }, (_, i) => i);

export const validSnapshot: CountrySnapshot = {
  version: 1,
  country: { slug: "germany", name: "Germany" },
  generatedAt: "2026-11-23T03:00:00.000Z",
  candidateCount: 2,
  users: [
    { rank: 1, id: 1, login: "a", name: "A", avatarUrl: "https://x/a.png", score: 66, years: [{ year: 2025, months }] },
  ],
};

test("accepts a well-formed snapshot", () => {
  assert.equal(isCountrySnapshot(validSnapshot), true);
});

test("rejects wrong version, missing fields, and bad month arrays", () => {
  assert.equal(isCountrySnapshot({ ...validSnapshot, version: 2 }), false);
  assert.equal(isCountrySnapshot({ ...validSnapshot, country: undefined }), false);
  assert.equal(isCountrySnapshot(null), false);
  const badMonths = structuredClone(validSnapshot);
  badMonths.users[0].years[0].months = [1, 2, 3];
  assert.equal(isCountrySnapshot(badMonths), false);
});

test("buildIndex replaces rebuilt countries and keeps the rest", () => {
  const previous: RankingsIndex = {
    version: 1,
    generatedAt: "2026-11-22T03:00:00.000Z",
    countries: [
      { slug: "germany", name: "Germany", updatedAt: "2026-11-22T03:00:00.000Z", userCount: 1, leader: null },
      { slug: "france", name: "France", updatedAt: "2026-11-22T03:00:00.000Z", userCount: 5, leader: null },
    ],
  };
  const index = buildIndex(previous, [validSnapshot], ["germany", "france", "japan"], new Date("2026-11-23T04:00:00.000Z"));
  assert.equal(isRankingsIndex(index), true);
  assert.deepEqual(index.countries.map((c) => c.slug), ["germany", "france"]);
  assert.equal(index.countries[0].updatedAt, "2026-11-23T03:00:00.000Z");
  assert.deepEqual(index.countries[0].leader, { login: "a", avatarUrl: "https://x/a.png", score: 66 });
  assert.equal(index.countries[1].userCount, 5);
  assert.equal(index.generatedAt, "2026-11-23T04:00:00.000Z");
});
