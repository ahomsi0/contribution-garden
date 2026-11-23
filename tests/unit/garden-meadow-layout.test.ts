import assert from "node:assert/strict";
import test from "node:test";
import {
  createMeadowLayout,
  meadowTuftBudget,
  type MeadowLayoutOptions,
  visibleTuftCount,
} from "@/components/garden/world/meadow-layout";

const pond = { x: -2.35, z: 1.25, scale: 1 };

function calendar(fromYear: number, toYear: number, count: (i: number) => number) {
  const days: { date: string; count: number }[] = [];
  let i = 0;
  for (let t = Date.UTC(fromYear, 0, 1); t < Date.UTC(toYear + 1, 0, 1); t += 86_400_000) {
    days.push({ date: new Date(t).toISOString().slice(0, 10), count: count(i) });
    i += 1;
  }
  return days;
}

const options = (extra: Partial<MeadowLayoutOptions> = {}): MeadowLayoutOptions => ({
  days: calendar(2022, 2024, (i) => (i % 3 === 0 ? 0 : 1 + (i % 12))),
  density: 1,
  seed: 11,
  pond,
  ...extra,
});

test("meadow layout is deterministic for a seed", () => {
  assert.deepEqual(createMeadowLayout(options()), createMeadowLayout(options()));
  assert.notDeepEqual(
    createMeadowLayout(options()),
    createMeadowLayout(options({ seed: 12 })),
  );
});

test("meadow layout skips days after visibleThrough and empty days", () => {
  const opts = options({ visibleThrough: "2023-06-30" });
  const tufts = createMeadowLayout(opts);
  assert.ok(tufts.length > 0);
  for (const tuft of tufts) {
    const day = opts.days[tuft.dayIndex];
    assert.ok(day.date <= "2023-06-30", `${day.date} is after visibleThrough`);
    assert.ok(day.count > 0);
    assert.ok(tuft.level >= 1 && tuft.level <= 4);
  }
  assert.ok(tufts.length < createMeadowLayout(options()).length);
});

test("a heavy history is capped at the budget and drawn fuller", () => {
  const days = calendar(2008, 2025, () => 40); // 18 years, 6 tufts a day wanted
  const tufts = createMeadowLayout({ days, density: 1, seed: 3, pond });
  assert.ok(tufts.length <= meadowTuftBudget(1) + 1, `${tufts.length} tufts`);
  assert.ok(tufts.length >= meadowTuftBudget(1) - 1);
  assert.ok(tufts.every((tuft) => tuft.girth >= 1));
  assert.ok(tufts.some((tuft) => tuft.girth > 1));
  // Every day is still represented, so every day stays selectable.
  assert.equal(new Set(tufts.map((tuft) => tuft.dayIndex)).size, days.length);
});

test("the full meadow reveals by count: its first tufts are the visible days' tufts", () => {
  const full = createMeadowLayout(options());
  for (const through of ["2022-01-01", "2022-09-14", "2023-06-30", "2024-12-31"]) {
    const cut = createMeadowLayout(options({ visibleThrough: through }));
    const shown = visibleTuftCount(full, options().days, through);
    assert.equal(shown, cut.length, `through ${through}`);
    assert.deepEqual(full.slice(0, shown), cut, `through ${through}`);
  }
  assert.equal(visibleTuftCount(full, options().days, undefined), full.length);
  assert.equal(visibleTuftCount(full, options().days, "2021-12-31"), 0);
  assert.equal(visibleTuftCount([], [], "2023-01-01"), 0);
});
