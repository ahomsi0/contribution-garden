import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { YearBeds } from "@/components/leaderboard/YearBeds";

const months = (values: number[]) => Array.from({ length: 12 }, (_, i) => values[i] ?? 0);

test("draws one titled bed per year and a stem per non-zero month", () => {
  const html = renderToStaticMarkup(
    <YearBeds
      years={[
        { year: 2024, months: months([5, 0, 3]) },
        { year: 2025, months: months([900]) },
      ]}
      scaleMax={900}
    />,
  );
  assert.equal(html.match(/<title>/g)?.length, 2);
  assert.match(html, /<title>2024 · 8 contributions<\/title>/);
  assert.match(html, /<title>2025 · 900 contributions<\/title>/);
  assert.doesNotMatch(html, /<line /);
  const commands = [...html.matchAll(/<path d="([^"]*)"/g)].flatMap((m) => m[1].match(/M/g) ?? []);
  assert.equal(commands.length, 3, "one M segment per non-zero month");
  for (const bed of html.split("<g>").slice(1)) {
    assert.ok((bed.match(/<path /g)?.length ?? 0) <= 4, "at most 4 paths per bed");
  }
  assert.equal(html.match(/<circle /g)?.length, 1, "flower only on 2025's 900-month");
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="2024–2025: 908 contributions"/);
});

test("emits coordinates rounded to at most 2 decimals so SSR and hydration agree", () => {
  const html = renderToStaticMarkup(
    <YearBeds
      years={[
        { year: 2019, months: months([7, 13, 101, 3, 0, 55, 9, 1, 2, 17, 33, 900]) },
        { year: 2020, months: months([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) },
        { year: 2021, months: months([400]) },
      ]}
      scaleMax={900}
    />,
  );
  assert.doesNotMatch(html, /="-?\d+\.\d{3,}"/);
});

test("renders an empty-but-valid svg for a user with no years", () => {
  const html = renderToStaticMarkup(<YearBeds years={[]} scaleMax={0} />);
  assert.match(html, /^<svg/);
  assert.match(html, /aria-label="No contributions yet"/);
});
