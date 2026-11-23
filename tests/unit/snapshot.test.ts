import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeWithPrevious,
  rankUsers,
  refetchFromYear,
  rollUpMonths,
  scoreFromYears,
  type UnrankedUser,
} from "@/lib/rankings/snapshot";

const zeros = () => Array.from({ length: 12 }, () => 0);

test("rollUpMonths buckets days by year and month, oldest year first", () => {
  const years = rollUpMonths([
    { date: "2024-02-29", count: 4 },
    { date: "2023-12-31", count: 2 },
    { date: "2024-01-01", count: 1 },
    { date: "2024-02-01", count: 3 },
  ]);
  assert.deepEqual(years.map((y) => y.year), [2023, 2024]);
  assert.equal(years[0].months[11], 2);
  assert.equal(years[1].months[0], 1);
  assert.equal(years[1].months[1], 7);
  assert.equal(years[1].months.length, 12);
});

test("rollUpMonths ignores negative counts and malformed dates", () => {
  const years = rollUpMonths([
    { date: "2024-05-01", count: -3 },
    { date: "not-a-date", count: 9 },
    { date: "2024-05-02", count: 2 },
  ]);
  assert.deepEqual(years, [{ year: 2024, months: [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0] }]);
});

test("scoreFromYears sums every month", () => {
  const a = zeros();
  a[0] = 5;
  const b = zeros();
  b[11] = 7;
  assert.equal(scoreFromYears([{ year: 2020, months: a }, { year: 2021, months: b }]), 12);
});

test("refetchFromYear is the current year, or last year during January", () => {
  assert.equal(refetchFromYear(new Date("2026-11-23T00:00:00Z")), 2026);
  assert.equal(refetchFromYear(new Date("2026-01-15T00:00:00Z")), 2025);
});

test("mergeWithPrevious keeps stored past years and replaces refetched ones", () => {
  const old2024 = zeros();
  old2024[0] = 10;
  const stale2026 = zeros();
  stale2026[0] = 1;
  const fresh2026 = zeros();
  fresh2026[0] = 4;
  const merged = mergeWithPrevious(
    [
      { year: 2024, months: old2024 },
      { year: 2026, months: stale2026 },
    ],
    [{ year: 2026, months: fresh2026 }],
    2026,
  );
  assert.deepEqual(merged.map((y) => [y.year, y.months[0]]), [
    [2024, 10],
    [2026, 4],
  ]);
});

test("rankUsers sorts by score and uses competition ranking for ties", () => {
  const user = (login: string, score: number): UnrankedUser => ({
    id: login.length + score,
    login,
    name: null,
    avatarUrl: "",
    score,
    years: [],
  });
  const ranked = rankUsers([user("c", 5), user("a", 9), user("b", 9), user("d", 1)], 3);
  assert.deepEqual(
    ranked.map((u) => [u.login, u.rank]),
    [
      ["a", 1],
      ["b", 1],
      ["c", 3],
    ],
  );
});
