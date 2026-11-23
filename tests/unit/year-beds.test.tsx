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
  assert.equal(html.match(/<line /g)?.length, 3);
  assert.equal(html.match(/<circle /g)?.length, 1, "flower only on 2025's 900-month");
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="2024–2025: 908 contributions"/);
});

test("renders an empty-but-valid svg for a user with no years", () => {
  const html = renderToStaticMarkup(<YearBeds years={[]} scaleMax={0} />);
  assert.match(html, /^<svg/);
  assert.match(html, /aria-label="No contributions yet"/);
});
