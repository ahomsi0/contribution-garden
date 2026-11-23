import assert from "node:assert/strict";
import test from "node:test";
import {
  createFloraLayout,
  createMeadowBeds,
  greatTreeClearance,
  insidePond,
  onThickMeadow,
  PATH_CLEARANCE,
  POND_CLEARANCE,
  TREE_CLEARANCE,
  type FloraLayoutInput,
} from "@/components/garden/world/flora-layout";
import { computeGardenLayout, distanceToPath, type MappingInput } from "@/components/garden/world/mapping";

function calendar(fromYear: number, toYear: number, count: (i: number) => number) {
  const days: { date: string; count: number }[] = [];
  let i = 0;
  for (let t = Date.UTC(fromYear, 0, 1); t < Date.UTC(toYear + 1, 0, 1); t += 86_400_000) {
    days.push({ date: new Date(t).toISOString().slice(0, 10), count: count(i) });
    i += 1;
  }
  return days;
}

const channel = [
  { x: -4.5, z: 2.5, radius: 0.8 },
  { x: -5.6, z: 3.1, radius: 0.8 },
];

function floraInput(social: number, extra: Partial<MappingInput> = {}): FloraLayoutInput {
  const days = calendar(2019, 2024, (i) => (i % 2 === 0 ? 3 + (i % 7) : 0));
  const layout = computeGardenLayout({
    days,
    stats: { pullRequests: social, issues: 0, repositories: 10, streak: 20 },
    activity: 0.6,
    season: "summer",
    seed: 5,
    density: 1,
    ...extra,
  });
  return {
    layout,
    channel,
    meadow: createMeadowBeds(days),
    onIsland: (x, z) => Math.hypot(x, z) < layout.islandRadius * 0.92,
    seed: 41,
  };
}

test("flora layout is deterministic per seed", () => {
  assert.deepEqual(createFloraLayout(floraInput(40)), createFloraLayout(floraInput(40)));
  assert.notDeepEqual(
    createFloraLayout(floraInput(40)).flowers,
    createFloraLayout({ ...floraInput(40), seed: 42 }).flowers,
  );
});

test("flower count follows pull requests and issues", () => {
  const light = createFloraLayout(floraInput(0));
  const heavy = createFloraLayout(floraInput(800));
  assert.equal(light.flowers.length, floraInput(0).layout.flowerCount);
  assert.equal(heavy.flowers.length, floraInput(800).layout.flowerCount);
  assert.ok(heavy.flowers.length > light.flowers.length * 5);
});

test("flowers, shrubs and rocks keep clear of the path, pond, channel and trees", () => {
  const input = floraInput(500);
  const { layout } = input;
  const flora = createFloraLayout(input);
  assert.ok(flora.shrubs.length > 0 && flora.rocks.length > 0);
  const points = [
    ...flora.flowers.map((f) => ({ x: f.x, z: f.z })),
    ...flora.shrubs.map((s) => ({ x: s.x, z: s.z })),
    ...flora.rocks.map((r) => ({ x: r.x, z: r.z })),
  ];
  for (const p of points) {
    assert.ok(distanceToPath(p.x, p.z) >= PATH_CLEARANCE);
    assert.ok(!insidePond(layout.pond, p.x, p.z, POND_CLEARANCE));
    for (const c of channel) assert.ok(Math.hypot(p.x - c.x, p.z - c.z) >= c.radius);
    for (const t of layout.yearTrees) assert.ok(Math.hypot(p.x - t.x, p.z - t.z) >= TREE_CLEARANCE);
    assert.ok(
      Math.hypot(p.x - layout.greatTree.x, p.z - layout.greatTree.z) >=
        greatTreeClearance(layout.greatTree.scale),
    );
  }
  for (const f of flora.flowers) {
    const r = Math.hypot(f.x, f.z);
    assert.ok(r >= 2.4 && r <= layout.islandRadius - 1);
  }
});

test("flowers mostly avoid the thick meadow beds", () => {
  const input = floraInput(800);
  const flora = createFloraLayout(input);
  const onBeds = flora.flowers.filter((f) => onThickMeadow(input.meadow, f.x, f.z)).length;
  assert.ok(onBeds <= flora.flowers.length * 0.1, `${onBeds} of ${flora.flowers.length} on beds`);
});

test("stepping stones run along the path at an even spacing", () => {
  const flora = createFloraLayout(floraInput(10));
  assert.ok(flora.stones.length >= 12);
  for (const stone of flora.stones) assert.ok(distanceToPath(stone.x, stone.z) < 0.25);
  for (let i = 1; i < flora.stones.length; i += 1) {
    const gap = Math.hypot(
      flora.stones[i].x - flora.stones[i - 1].x,
      flora.stones[i].z - flora.stones[i - 1].z,
    );
    assert.ok(gap > 0.7 && gap < 1.25, `gap ${gap}`);
  }
});

test("winter leaves almost no flowers", () => {
  const winter = createFloraLayout(floraInput(800, { season: "winter" }));
  const summer = createFloraLayout(floraInput(800));
  assert.ok(winter.flowers.length < summer.flowers.length * 0.2);
});
