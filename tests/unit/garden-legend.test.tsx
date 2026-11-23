import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GardenLegend } from "@/components/ui/GardenLegend";

test("legend lists seven rows under a Reading the garden summary", () => {
  const html = renderToStaticMarkup(<GardenLegend provider="github" />);
  assert.match(html, /<details/);
  assert.match(html, /Reading the garden/);
  assert.equal(html.match(/<li /g)?.length, 7);
  assert.match(html, /pull requests and issues this past year/);
  assert.doesNotMatch(html, /not available on GitLab/);
});

test("GitLab legend marks wildflowers as unavailable", () => {
  const html = renderToStaticMarkup(<GardenLegend provider="gitlab" />);
  assert.equal(html.match(/<li /g)?.length, 7);
  assert.match(html, /Wildflowers<\/strong>: not available on GitLab/);
  assert.doesNotMatch(html, /pull requests and issues this past year/);
});
