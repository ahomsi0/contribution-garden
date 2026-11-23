import assert from "node:assert/strict";
import test from "node:test";
import { entityForUI, selectionForUI } from "@/components/garden-selection";
import type { GardenSelection } from "@/components/garden/types";

const factsOf = (selection: GardenSelection) => {
  const entity = entityForUI(selectionForUI(selection), 0.8);
  assert.ok(entity);
  return { entity, facts: new Map(entity.facts?.map((fact) => [fact.label, fact.value])) };
};

const yearTree: GardenSelection = {
  kind: "tree",
  id: "year-tree-2019",
  title: "2019",
  subtitle: "A year of contributions",
  description: "This tree grew from every contribution made in 2019.",
  accent: "#5f8f3a",
  worldPosition: [4, 3, -2],
  details: [
    { label: "Contributions", value: "1,204" },
    { label: "Busiest month", value: "March" },
    { label: "Active days", value: "211" },
  ],
  count: 1204,
};

const flower: GardenSelection = {
  kind: "flower",
  id: "wildflower-3",
  title: "Wildflowers",
  subtitle: "Pull requests and issues",
  description: "Every pull request and issue opened in the past year seeds more wildflowers.",
  accent: "#e6a1c4",
  worldPosition: [1, 0.6, 2],
  count: 410,
  details: [
    { label: "Pull requests (12 mo)", value: "300" },
    { label: "Issues (12 mo)", value: "110" },
  ],
};

test("a year tree's specimen card shows its contributions, busiest month and active days", () => {
  const { entity, facts } = factsOf(yearTree);
  assert.equal(entity.kind, "tree");
  assert.equal(entity.title, "2019");
  assert.equal(entity.description, yearTree.description);
  assert.equal(facts.get("Contributions"), "1,204");
  assert.equal(facts.get("Busiest month"), "March");
  assert.equal(facts.get("Active days"), "211");
  assert.equal(entity.accent, "#5f8f3a");
});

test("a flower's specimen card has no contribution count but lists pull requests and issues", () => {
  const { entity, facts } = factsOf(flower);
  assert.equal(entity.kind, "flower");
  assert.equal(entity.contributionCount, undefined);
  assert.equal(facts.get("Pull requests (12 mo)"), "300");
  assert.equal(facts.get("Issues (12 mo)"), "110");
});

test("day, pond and great-tree selections keep working", () => {
  const day = factsOf({
    kind: "contribution",
    id: "day-2024-05-02",
    title: "May 2, 2024",
    subtitle: "Daily activity plot",
    description: "7 contributions grew this plot in the 2024 annual bed.",
    accent: "#8fbf5a",
    worldPosition: [0, 0, 0],
    date: "2024-05-02",
    count: 7,
    repositories: ["vercel/next.js", "vercel/turbo"],
    details: [
      { label: "Date", value: "2024-05-02" },
      { label: "Contributions", value: 7 },
      { label: "Intensity", value: "3/4" },
      { label: "Repositories", value: "vercel/next.js, vercel/turbo" },
    ],
  });
  assert.equal(day.entity.kind, "plant");
  assert.equal(day.entity.date, "2024-05-02");
  assert.equal(day.facts.get("Contributions"), "7");
  assert.equal(day.facts.get("Repositories"), "vercel/next.js, vercel/turbo");

  const pond = factsOf({
    kind: "water",
    id: "activity-pond",
    title: "Activity pond",
    subtitle: "Recent activity",
    description: "Recent momentum keeps the garden water bright and clear.",
    accent: "#9bd8d0",
    worldPosition: [0, 0, 0],
    count: 3500,
    details: [
      { label: "Garden health", value: "81%" },
      { label: "Contributions", value: "3,500" },
      { label: "Repositories", value: 120 },
    ],
  });
  assert.equal(pond.entity.kind, "water");
  assert.equal(pond.facts.get("Garden health"), "81%");
  assert.equal(pond.facts.get("Repositories"), "120");

  const great = factsOf({
    kind: "achievement",
    id: "great-tree",
    title: "Great tree",
    subtitle: "Lifetime contributions",
    description: "Every contribution ever made grew this tree.",
    accent: "#9bd8d0",
    worldPosition: [0, 0, 0],
    count: 35000,
    details: [
      { label: "Lifetime contributions", value: "35,000" },
      { label: "Longest streak", value: "400 days" },
      { label: "Years growing", value: 15 },
    ],
  });
  assert.equal(great.entity.kind, "landmark");
  assert.equal(great.facts.get("Lifetime contributions"), "35,000");
  assert.equal(great.facts.get("Years growing"), "15");

  assert.equal(selectionForUI(null), null);
  assert.equal(entityForUI(null, 0.5), null);
});
