import assert from "node:assert/strict";
import test from "node:test";
import { boardScaleMax, stemValue } from "@/lib/rankings/bed-scale";

test("boardScaleMax is the largest single month on the board", () => {
  const months = (peak: number) => Array.from({ length: 12 }, (_, i) => (i === 3 ? peak : 1));
  assert.equal(
    boardScaleMax([
      { years: [{ year: 2020, months: months(40) }] },
      { years: [{ year: 2021, months: months(900) }, { year: 2022, months: months(5) }] },
    ]),
    900,
  );
  assert.equal(boardScaleMax([]), 0);
});

test("stemValue is a 0..1 log scale against the shared max", () => {
  assert.equal(stemValue(0, 900), 0);
  assert.equal(stemValue(900, 900), 1);
  assert.equal(stemValue(5, 0), 0);
  assert.equal(stemValue(2000, 900), 1);
  const small = stemValue(10, 900);
  assert.ok(small > 0.3 && small < 0.4, String(small));
});
