import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Board } from "@/components/leaderboard/Board";

const user = (id: number) => ({
  id,
  rank: id,
  login: `user${id}`,
  name: null,
  avatarUrl: `https://avatars.githubusercontent.com/u/${id}?v=4`,
  score: 10,
  years: [],
});

test("filter input is labelled and a polite live region reports the count", () => {
  const html = renderToStaticMarkup(<Board slug="germany" users={[user(1), user(2)]} scaleMax={10} />);
  assert.match(html, /placeholder="Filter by name"/);
  assert.match(html, /aria-label="Filter by name"/);
  assert.match(html, /<p[^>]*class="sr-only"[^>]*aria-live="polite"[^>]*>2 of 2 gardeners<\/p>|<p[^>]*aria-live="polite"[^>]*class="sr-only"[^>]*>2 of 2 gardeners<\/p>/);
});
