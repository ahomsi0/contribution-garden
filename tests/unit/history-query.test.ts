import assert from "node:assert/strict";
import test from "node:test";
import { contributionHistoryQuery } from "@/lib/github/history-query";

const now = new Date("2026-11-23T10:00:00.000Z");

test("requests repository detail only for the two most recent years", () => {
  const query = contributionHistoryQuery([2026, 2025, 2024, 2023], now);
  assert.equal(query.match(/commitContributionsByRepository/g)?.length, 2);
  assert.match(query, /y2026: contributionsCollection\(from: "2026-01-01T00:00:00.000Z", to: "2026-11-23T10:00:00.000Z"\)/);
  assert.match(query, /y2023: contributionsCollection\(from: "2023-01-01T00:00:00.000Z", to: "2023-12-31T23:59:59.000Z"\)/);
});

test("keeps the operation name the API tests match on", () => {
  assert.match(contributionHistoryQuery([2026], now), /query ContributionGardenHistory\(\$login: String!\)/);
});

test("only the 2026 and 2025 blocks include repository detail", () => {
  const query = contributionHistoryQuery([2026, 2025, 2024, 2023], now);
  const block = (year: number) =>
    query.split(/(?=\by20\d\d: contributionsCollection)/).find((part) => part.trimStart().startsWith(`y${year}:`)) ?? "";
  for (const year of [2026, 2025]) {
    assert.match(block(year), /commitContributionsByRepository/, `y${year}`);
  }
  for (const year of [2024, 2023]) {
    assert.doesNotMatch(block(year), /commitContributionsByRepository/, `y${year}`);
  }
});
