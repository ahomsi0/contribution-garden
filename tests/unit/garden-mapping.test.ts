import assert from "node:assert/strict";
import test from "node:test";
import {
  bladesForDay,
  computeGardenLayout,
  distanceToPath,
  intensityLevel,
  type MappingInput,
} from "@/components/garden/world/mapping";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function lightDays() {
  const days: { date: string; count: number }[] = [];
  for (let i = 0; i < 23; i += 1) {
    const year = 2014 + (i % 5);
    const month = Math.floor(i / 5) + 1;
    days.push({
      date: `${year}-${String(month).padStart(2, "0")}-10`,
      count: i < 6 ? 1 : 2,
    });
  }
  return days;
}

function heavyDays() {
  const days: { date: string; count: number }[] = [];
  let i = 0;
  for (let t = Date.UTC(2009, 0, 1); t <= Date.UTC(2026, 10, 20); t += 86_400_000) {
    days.push({ date: day(t), count: 5 + (i % 16) });
    i += 1;
  }
  return days;
}

const base = {
  season: "summer",
  seed: 7,
  density: 1,
  activity: 0.8,
} as const;

function input(
  days: { date: string; count: number }[],
  streak: number,
  extra: Partial<MappingInput> = {},
): MappingInput {
  return {
    ...base,
    days,
    stats: { pullRequests: 10, issues: 5, repositories: 8, streak },
    ...extra,
  };
}

const light = () => computeGardenLayout(input(lightDays(), 3));
const heavy = () => computeGardenLayout(input(heavyDays(), 900));

test("intensityLevel boundaries", () => {
  const expected: [number, number][] = [[0, 0], [1, 1], [2, 1], [3, 2], [5, 2], [6, 3], [9, 3], [10, 4], [500, 4]];
  for (const [count, level] of expected) assert.equal(intensityLevel(count), level, `count ${count}`);
});

test("bladesForDay scales with count and density", () => {
  for (const [c, b] of [[1, 1], [2, 2], [4, 3], [31, 5], [1000, 6]] as const) {
    assert.equal(bladesForDay(c, 1), b, `count ${c}`);
  }
  assert.equal(bladesForDay(1, 0.5), 1);
  assert.equal(bladesForDay(1000, 0.5), 3);
  assert.equal(bladesForDay(0, 1), 0);
});

test("heavy history yields a bigger island and trees than a light one", () => {
  const l = light();
  const h = heavy();
  assert.ok(h.islandRadius > l.islandRadius);
  assert.equal(h.yearTrees.length, 18);
  assert.equal(l.yearTrees.length, 5);
  assert.ok(Math.max(...h.yearTrees.map((t) => t.scale)) >= 1.7);
  assert.ok(Math.max(...l.yearTrees.map((t) => t.scale)) <= 1.2);
  assert.ok(h.greatTree.scale - l.greatTree.scale >= 0.6);
  assert.ok(h.fireflyCount > 0);
  assert.equal(l.fireflyCount, 0);
  assert.equal(h.greatTree.glowing, true);
  assert.equal(l.greatTree.glowing, false);
});

test("visibleThrough cuts off later years", () => {
  const all = heavyDays();
  const cut = computeGardenLayout(input(all, 900, { visibleThrough: "2012-12-31" }));
  assert.equal(cut.yearTrees.length, 4);
  const expected = all.filter((d) => d.date <= "2012-12-31").reduce((s, d) => s + d.count, 0);
  assert.equal(cut.lifetime, expected);
});

test("layout is deterministic per seed", () => {
  const a = heavy();
  assert.deepEqual(heavy(), a);
  const b = computeGardenLayout(input(heavyDays(), 900, { seed: 8 }));
  assert.equal(b.yearTrees.length, a.yearTrees.length);
  assert.notDeepEqual(
    b.yearTrees.map((t) => [t.x, t.z]),
    a.yearTrees.map((t) => [t.x, t.z]),
  );
});

test("no year tree sits on the path", () => {
  for (const t of heavy().yearTrees) assert.ok(distanceToPath(t.x, t.z) >= 1.1, `year ${t.year}`);
});

test("year trees sit on the ring", () => {
  const h = heavy();
  for (const t of h.yearTrees) {
    assert.ok(Math.abs(Math.hypot(t.x, t.z) - h.treeRingRadius) <= 0.36, `year ${t.year}`);
  }
});

test("empty days give the minimal garden", () => {
  const e = computeGardenLayout(input([], 0));
  assert.equal(e.spanYears, 0);
  assert.equal(e.islandRadius, 9);
  assert.equal(e.yearTrees.length, 0);
  assert.equal(e.greatTree.scale, 0.9);
  assert.equal(e.lifetime, 0);
});

test("an obstacle on the ring keeps every year tree clear of it", () => {
  for (const days of [lightDays(), heavyDays()]) {
    const ring = computeGardenLayout(input(days, 3)).treeRingRadius;
    for (let k = 0; k < 24; k += 1) {
      const angle = (k / 24) * Math.PI * 2;
      const obstacle = { x: Math.cos(angle) * ring, z: Math.sin(angle) * ring, radius: 0.8 };
      const layout = computeGardenLayout(input(days, 3, { obstacles: [obstacle] }));
      for (const tree of layout.yearTrees) {
        const gap = Math.hypot(tree.x - obstacle.x, tree.z - obstacle.z);
        assert.ok(
          gap >= obstacle.radius + 0.6,
          `tree ${tree.year} is ${gap.toFixed(2)} from an obstacle at ${angle.toFixed(2)} rad`,
        );
      }
    }
  }
});

const angleOf = (tree: { x: number; z: number }) => Math.atan2(tree.z, tree.x);
const sameAngle = (a: number, b: number) => {
  const gap = Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  return gap <= 1e-9;
};

test("a year tree keeps its angle while later years appear", () => {
  const days = heavyDays();
  for (let year = 2009; year <= 2021; year += 1) {
    const early = computeGardenLayout(input(days, 900, { visibleThrough: `${year + 1}-12-31` }));
    const late = computeGardenLayout(input(days, 900, { visibleThrough: `${year + 5}-12-31` }));
    const a = early.yearTrees.find((tree) => tree.year === year);
    const b = late.yearTrees.find((tree) => tree.year === year);
    assert.ok(a && b, `year ${year} has a tree in both`);
    assert.ok(
      sameAngle(angleOf(a), angleOf(b)),
      `year ${year}: ${angleOf(a)} vs ${angleOf(b)}`,
    );
    assert.equal(a.rotation, b.rotation, `year ${year} rotation`);
    assert.equal(a.evergreen, b.evergreen, `year ${year} evergreen`);
  }
});

test("a year tree keeps its angle with an obstacle in play", () => {
  const days = heavyDays();
  const full = computeGardenLayout(input(days, 900));
  const obstacle = { x: Math.cos(1.2) * full.treeRingRadius, z: Math.sin(1.2) * full.treeRingRadius, radius: 0.8 };
  const fullTrees = computeGardenLayout(input(days, 900, { obstacles: [obstacle] })).yearTrees;
  for (const through of ["2010-06-30", "2013-12-31", "2019-12-31"]) {
    const layout = computeGardenLayout(input(days, 900, { visibleThrough: through, obstacles: [obstacle] }));
    for (const tree of layout.yearTrees) {
      const final = fullTrees.find((t) => t.year === tree.year)!;
      assert.ok(sameAngle(angleOf(tree), angleOf(final)), `year ${tree.year} through ${through}`);
      assert.ok(distanceToPath(tree.x, tree.z) >= 1.1, `year ${tree.year} on the path through ${through}`);
    }
  }
});

test("shrub and rock counts don't change with visibleThrough", () => {
  const days = heavyDays();
  const full = computeGardenLayout(input(days, 900));
  for (const through of ["2009-03-01", "2011-12-31", "2016-07-04", "2026-01-01"]) {
    const cut = computeGardenLayout(input(days, 900, { visibleThrough: through }));
    assert.equal(cut.shrubCount, full.shrubCount, `shrubs through ${through}`);
    assert.equal(cut.rockCount, full.rockCount, `rocks through ${through}`);
  }
});
