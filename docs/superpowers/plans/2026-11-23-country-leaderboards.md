# Country Leaderboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-country GitHub leaderboards ranked by lifetime contributions, with a "year beds" mini-garden per person, and make the existing 3D garden the per-person detail page at `/u/<login>`.

**Architecture:** A daily GitHub Action runs `scripts/build-rankings.ts`, which searches GitHub for users per country, fetches each user's per-year contribution calendar, and uploads one JSON snapshot per country to Vercel Blob. The site's server components read those snapshots (in-memory cache, 10 min) and render the board; the year beds are plain SVG from a pure component. All ranking logic lives in small pure modules under `lib/rankings/` with unit tests.

**Tech Stack:** vinext (Next.js 16 app router on Vite), React 19, TypeScript, `node:test` + `tsx` for unit tests, `@vercel/blob`, GitHub GraphQL + REST search APIs, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-23-country-leaderboards-design.md`

---

## Ground rules for the implementer

- Run commands from the repo root: `/Users/ahomsi/Development/Personal Projects/Contribution Garden` (path has spaces — quote it).
- Branch: `country-leaderboards` (already exists, spec committed).
- Two test suites after Task 2:
  - `npm run test:unit` — fast, pure TypeScript tests in `tests/unit/` (no build).
  - `npm test` — builds the Cloudflare worker (`npm run build`) then runs `tests/*.test.mjs` against `dist/server/index.js`. Slow (~1 min). Run it where a task says so.
- `npm run typecheck` and `npm run lint` must pass at the end of every Part.
- Never put real tokens in code, tests, or commits.
- Commit after each task with the message shown, ending with the line:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File map

**Part A — prerequisites (garden fixes)**
- Modify `components/GardenPortal.tsx`, `components/ContributionGarden.tsx`, `components/garden-portal.css` — user's uncommitted hero swap (Task 1)
- Modify `tests/rendered-html.test.mjs` — hero assertion (Task 1), new render tests (Task 20)
- Modify `package.json` — `test:unit` script, `tsx` + `@vercel/blob` deps (Tasks 2, 12)
- Create `lib/github/history-query.ts` — builds the per-year history GraphQL query (Task 3)
- Modify `app/api/github/[username]/route.ts` — use history-query; later the extracted client (Tasks 3, 9)
- Modify `lib/github-types.ts` — `lifetimeContributions()` (Task 4)
- Modify `components/ui/GardenUI.tsx` — `lifetime` metric key (Task 4)

**Part B — pure ranking core**
- Create `lib/rankings/countries.ts` — country config + lookup (Task 5)
- Create `lib/rankings/snapshot.ts` — types, roll-up, scoring, merge, ranking, validators, index builder (Tasks 6–7)
- Create `lib/rankings/bed-scale.ts` — shared-scale stem heights (Task 8)
- Create `lib/rankings/format.ts` — "updated N hours ago" text (Task 8)

**Part C — pipeline**
- Create `lib/github/graphql.ts` — `fetchGraphQL`, `GitHubRequestError`, `mapWithConcurrency`, `chunk` (Task 9)
- Create `lib/rankings/github-source.ts` — search + per-user history fetch (Tasks 10–11)
- Create `lib/rankings/snapshot-store.ts` — directory store + Vercel Blob store (Task 12)
- Create `lib/rankings/build.ts` — `buildCountry`, `orderCountriesByStaleness` (Task 13)
- Create `scripts/build-rankings.ts` — CLI entry (Task 14)
- Create `.github/workflows/rankings.yml` (Task 15)

**Part D — site**
- Create `lib/rankings/store.ts` — server-side snapshot reader with cache (Task 16)
- Create `components/leaderboard/YearBeds.tsx`, `Board.tsx`, `CountryGrid.tsx`, `leaderboard.css` (Tasks 17–19)
- Create `app/country/[slug]/page.tsx` (Task 18)
- Modify `app/page.tsx`, rewrite `components/GardenPortal.tsx` as hero-only (Task 19)
- Create `app/u/[login]/page.tsx`, `components/GardenRoute.tsx` (Task 20)
- Modify `components/ContributionGarden.tsx` — props, load-race fix, `/u/` URLs (Task 20)

All unit tests live in `tests/unit/*.test.ts`.

---

# Part A — Prerequisites

### Task 1: Commit the hero image swap and fix its test

The working tree has the user's uncommitted change from `garden-hero-v4-voxel.webp` to `garden-hero-v5-lush.webp` (3 files + the new image). The landing test still expects v4, so `npm test` fails today.

**Files:**
- Modify: `tests/rendered-html.test.mjs:83`
- Commit: `components/ContributionGarden.tsx`, `components/GardenPortal.tsx`, `components/garden-portal.css`, `public/garden-hero-v5-lush.webp`

- [ ] **Step 1: Confirm the diff is only the hero swap**

Run: `git diff --stat && git status --short`
Expected: the three component files each with 1 line changed, `?? public/garden-hero-v5-lush.webp`, `?? .claude/`. If anything else is modified, stop and ask the user.

- [ ] **Step 2: Update the test expectation**

In `tests/rendered-html.test.mjs`, change:

```js
  assert.match(html, /garden-hero-v4-voxel\.webp/);
```

to:

```js
  assert.match(html, /garden-hero-v5-lush\.webp/);
```

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/ContributionGarden.tsx components/GardenPortal.tsx components/garden-portal.css public/garden-hero-v5-lush.webp tests/rendered-html.test.mjs
git commit -m "Switch hero to the v5 lush image

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Unit test runner

**Files:**
- Modify: `package.json`
- Create: `tests/unit/smoke.test.ts`

- [ ] **Step 1: Install tsx as a dev dependency**

Run: `npm install --save-dev tsx@4.21.0`
Expected: `package.json` devDependencies gains `"tsx": "4.21.0"` (or `^4.21.0`).

- [ ] **Step 2: Add the script**

In `package.json` `"scripts"`, add after `"test"`:

```json
    "test:unit": "node --import tsx --test \"tests/unit/**/*.test.ts\"",
```

- [ ] **Step 3: Write a smoke test that uses the `@/` alias**

Create `tests/unit/smoke.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGardenHandle } from "@/lib/garden-provider";

test("unit runner resolves @/ imports", () => {
  assert.equal(normalizeGardenHandle("@Octocat", "github"), "octocat");
});
```

- [ ] **Step 4: Run it**

Run: `npm run test:unit`
Expected: `# pass 1`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/unit/smoke.test.ts
git commit -m "Add a fast unit test runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Make heavy users load fast (repository detail only for recent years)

`commitContributionsByRepository` is requested for every year; for long histories that took ~39 s. Only the two most recent years need it (it feeds the "repositories" list in the day detail panel).

**Files:**
- Create: `lib/github/history-query.ts`
- Modify: `app/api/github/[username]/route.ts` (HISTORY_FIELDS at ~line 146, `contributionHistoryQuery` at ~line 437, `RawContributionCollection` at ~line 278, `normalizeCalendar` at ~line 605)
- Test: `tests/unit/history-query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/history-query.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { contributionHistoryQuery } from "@/lib/github/history-query";

const now = new Date("2026-11-23T10:00:00.000Z");

test("requests repository detail only for the two most recent years", () => {
  const query = contributionHistoryQuery([2026, 2025, 2024, 2023], now);
  assert.equal(query.match(/commitContributionsByRepository/g)?.length, 2);
  assert.match(query, /y2026: contributionsCollection\(from: "2026-01-01T00:00:00.000Z", to: "2026-11-23T10:00:00.000Z"\)/);
  assert.match(query, /y2023: contributionsCollection\(from: "2023-01-01T00:00:00.000Z", to: "2023-12-31T23:59:59.000Z"\)/);
});

test("keeps the operation name the API tests match on", () => {
  assert.match(contributionHistoryQuery([2026], now), /query ContributionGardenHistory\(\$login: String!\)/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '@/lib/github/history-query'`.

- [ ] **Step 3: Create the module**

Create `lib/github/history-query.ts`:

```ts
const CALENDAR_FIELDS = /* GraphQL */ `
  totalCommitContributions
  totalIssueContributions
  totalPullRequestContributions
  totalPullRequestReviewContributions
  restrictedContributionsCount
  contributionCalendar {
    totalContributions
    weeks {
      contributionDays {
        date
        weekday
        contributionCount
        contributionLevel
        color
      }
    }
  }
`;

const REPOSITORY_FIELDS = /* GraphQL */ `
  commitContributionsByRepository(maxRepositories: 25) {
    repository { nameWithOwner isPrivate }
    contributions(first: 100) {
      nodes { occurredAt commitCount }
    }
  }
`;

/** Years at or after (currentYear - this) include per-repository commit detail. */
const REPOSITORY_DETAIL_YEARS = 1;

export function yearRange(year: number, now: Date): { from: string; to: string } {
  const from = `${year}-01-01T00:00:00.000Z`;
  const to =
    year === now.getUTCFullYear()
      ? now.toISOString()
      : new Date(Date.UTC(year + 1, 0, 1) - 1_000).toISOString();
  return { from, to };
}

export function contributionHistoryQuery(years: readonly number[], now: Date): string {
  const currentYear = now.getUTCFullYear();
  const selections = years
    .map((year) => {
      const { from, to } = yearRange(year, now);
      const withRepositories = year >= currentYear - REPOSITORY_DETAIL_YEARS;
      return `
        y${year}: contributionsCollection(from: "${from}", to: "${to}") {
          ${CALENDAR_FIELDS}
          ${withRepositories ? REPOSITORY_FIELDS : ""}
        }
      `;
    })
    .join("\n");

  return `
    query ContributionGardenHistory($login: String!) {
      user(login: $login) {
        ${selections}
      }
    }
  `;
}
```

- [ ] **Step 4: Use it in the route**

In `app/api/github/[username]/route.ts`:

1. Delete the `const HISTORY_FIELDS = ...` block and the local `function contributionHistoryQuery(...)`.
2. Add to the imports at the top: `import { contributionHistoryQuery } from "@/lib/github/history-query";`
3. In `interface RawContributionCollection`, make the field optional:

```ts
  commitContributionsByRepository?: Array<{
```

4. In `normalizeCalendar`, change the loop header to:

```ts
    for (const repositoryContributions of collection.commitContributionsByRepository ?? []) {
```

- [ ] **Step 5: Run unit tests, typecheck, and the API suite**

Run: `npm run test:unit && npm run typecheck && npm test`
Expected: all pass (the API tests match on `ContributionGardenHistory` and `y\d{4}: contributionsCollection`, both unchanged).

- [ ] **Step 6: Measure against the real API**

With the dev server running (`npm run dev`), run:

```bash
curl -s -o /dev/null -w "%{time_total}\n" http://localhost:3000/api/github/sindresorhus
```

Expected: well under the previous 38.7 s (target < 10 s on a cache miss). Restart the dev server first if it already cached that user.

- [ ] **Step 7: Commit**

```bash
git add lib/github/history-query.ts "app/api/github/[username]/route.ts" tests/unit/history-query.test.ts
git commit -m "Fetch repository detail only for recent years

Heavy accounts took ~39s because per-repository commit detail was
requested for every year of history.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Show a lifetime total in the 3D garden

The garden's Commits/PRs/Issues cards are intentionally "Last year" (pinned by an existing test). The board shows lifetime totals, so the garden needs a matching lifetime figure. The calendar already holds the full history, so this is computed client-side.

**Files:**
- Modify: `lib/github-types.ts` (append)
- Modify: `components/ui/GardenUI.tsx:85-93` (`GardenMetricKey`) and `:209-218` (`metricIcons`)
- Modify: `components/ContributionGarden.tsx:494-541` (`metrics` memo)
- Test: `tests/unit/lifetime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lifetime.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { lifetimeContributions } from "@/lib/github-types";

test("sums every calendar day", () => {
  assert.equal(
    lifetimeContributions([
      { count: 3 },
      { count: 0 },
      { count: 12 },
    ]),
    15,
  );
});

test("ignores negative or non-finite counts", () => {
  assert.equal(lifetimeContributions([{ count: -4 }, { count: Number.NaN }, { count: 2 }]), 2);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL — `lifetimeContributions` is not exported.

- [ ] **Step 3: Implement**

Append to `lib/github-types.ts`:

```ts
/** Lifetime total across the whole calendar (matches the leaderboard score). */
export function lifetimeContributions(
  calendar: ReadonlyArray<{ count: number }>,
): number {
  let total = 0;
  for (const day of calendar) {
    if (Number.isFinite(day.count) && day.count > 0) total += day.count;
  }
  return total;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Add the metric key and icon**

In `components/ui/GardenUI.tsx`, add `| "lifetime"` to `GardenMetricKey` (after `"contributions"`), and in `metricIcons` add `lifetime: TreeDeciduous,`. Add `TreeDeciduous` to the existing `lucide-react` import in that file.

- [ ] **Step 6: Show it in the garden**

In `components/ContributionGarden.tsx`, add `lifetimeContributions` to the existing `@/lib/github-types` import (or add the import if the file has none: `import { lifetimeContributions } from "@/lib/github-types";`). Then, just above `const metrics = useMemo<GardenMetric[]>(() => {`, add:

```ts
  const lifetimeTotal = useMemo(
    () => lifetimeContributions(data?.calendar ?? []),
    [data?.calendar],
  );
```

Inside the memo, add a new entry as the first element of `common`:

```ts
      {
        key: "lifetime" as const,
        label: "Lifetime",
        value: lifetimeTotal,
        detail: data?.source === "gitlab" ? "Past 12 months on GitLab" : "All public history",
      },
```

and add `lifetimeTotal` to the memo's dependency array. `common[0]` is now the lifetime card; update both `return` statements so they start with `common[0], common[1],` (lifetime, then contributions) followed by the rest exactly as before, i.e. change `...common.slice(1)` to `...common.slice(2)` in both places.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint`
Expected: no errors. Then in the browser at `http://localhost:3000/?user=octocat` (still the old flow until Task 20), the stats panel shows "Lifetime 39" (approximately) alongside "Contributions 0 · last year".

- [ ] **Step 8: Commit**

```bash
git add lib/github-types.ts components/ui/GardenUI.tsx components/ContributionGarden.tsx tests/unit/lifetime.test.ts
git commit -m "Show a lifetime contribution total in the garden

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Part B — Pure ranking core

### Task 5: Country config

**Files:**
- Create: `lib/rankings/countries.ts`
- Test: `tests/unit/countries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/countries.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRIES, findCountry } from "@/lib/rankings/countries";

test("ships ten launch countries with unique slugs", () => {
  assert.equal(COUNTRIES.length, 10);
  assert.equal(new Set(COUNTRIES.map((c) => c.slug)).size, COUNTRIES.length);
});

test("every country has a url-safe slug and at least two aliases", () => {
  for (const country of COUNTRIES) {
    assert.match(country.slug, /^[a-z0-9-]+$/);
    assert.ok(country.aliases.length >= 2, country.slug);
    assert.ok(country.aliases.every((alias) => alias.trim() === alias && alias.length > 0));
  }
});

test("findCountry looks up by slug only", () => {
  assert.equal(findCountry("germany")?.name, "Germany");
  assert.equal(findCountry("Germany"), undefined);
  assert.equal(findCountry("atlantis"), undefined);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/rankings/countries.ts`:

```ts
export interface CountryConfig {
  slug: string;
  name: string;
  /** Values matched against GitHub's free-text profile location. */
  aliases: string[];
}

export const COUNTRIES: readonly CountryConfig[] = [
  {
    slug: "united-states",
    name: "United States",
    aliases: ["United States", "USA", "San Francisco", "New York", "Seattle", "Los Angeles", "Austin", "Boston", "Chicago"],
  },
  {
    slug: "india",
    name: "India",
    aliases: ["India", "Bangalore", "Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai"],
  },
  {
    slug: "germany",
    name: "Germany",
    aliases: ["Germany", "Deutschland", "Berlin", "Munich", "München", "Hamburg", "Cologne", "Frankfurt"],
  },
  {
    slug: "united-kingdom",
    name: "United Kingdom",
    aliases: ["United Kingdom", "UK", "England", "London", "Manchester", "Edinburgh", "Scotland"],
  },
  {
    slug: "france",
    name: "France",
    aliases: ["France", "Paris", "Lyon", "Toulouse", "Marseille", "Nantes"],
  },
  {
    slug: "brazil",
    name: "Brazil",
    aliases: ["Brazil", "Brasil", "São Paulo", "Sao Paulo", "Rio de Janeiro", "Belo Horizonte"],
  },
  {
    slug: "canada",
    name: "Canada",
    aliases: ["Canada", "Toronto", "Vancouver", "Montreal", "Ottawa", "Waterloo"],
  },
  {
    slug: "netherlands",
    name: "Netherlands",
    aliases: ["Netherlands", "Nederland", "Amsterdam", "Rotterdam", "Utrecht", "Eindhoven"],
  },
  {
    slug: "japan",
    name: "Japan",
    aliases: ["Japan", "日本", "Tokyo", "東京", "Osaka", "Kyoto"],
  },
  {
    slug: "poland",
    name: "Poland",
    aliases: ["Poland", "Polska", "Warsaw", "Warszawa", "Kraków", "Krakow", "Wrocław"],
  },
];

export function findCountry(slug: string): CountryConfig | undefined {
  return COUNTRIES.find((country) => country.slug === slug);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/countries.ts tests/unit/countries.test.ts
git commit -m "Add leaderboard country config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Snapshot types, roll-up, scoring, merge, ranking

**Files:**
- Create: `lib/rankings/snapshot.ts`
- Test: `tests/unit/snapshot.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/snapshot.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/rankings/snapshot.ts`:

```ts
export interface YearMonths {
  year: number;
  /** Exactly 12 monthly contribution totals, January first. */
  months: number[];
}

export interface UnrankedUser {
  /** GitHub databaseId — stable across renames. */
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  /** Lifetime total contributions. */
  score: number;
  /** Oldest year first. */
  years: YearMonths[];
}

export interface RankedUser extends UnrankedUser {
  /** 1-based competition ranking: 1, 2, 2, 4. */
  rank: number;
}

export interface CountrySnapshot {
  version: 1;
  country: { slug: string; name: string };
  generatedAt: string;
  candidateCount: number;
  users: RankedUser[];
}

export interface RankingsIndexEntry {
  slug: string;
  name: string;
  updatedAt: string;
  userCount: number;
  leader: { login: string; avatarUrl: string; score: number } | null;
}

export interface RankingsIndex {
  version: 1;
  generatedAt: string;
  countries: RankingsIndexEntry[];
}

export interface DailyCount {
  date: string;
  count: number;
}

export function rollUpMonths(days: readonly DailyCount[]): YearMonths[] {
  const byYear = new Map<number, number[]>();
  for (const day of days) {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(day.date);
    if (!match) continue;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    if (month < 0 || month > 11) continue;
    const months = byYear.get(year) ?? Array.from({ length: 12 }, () => 0);
    months[month] += Number.isFinite(day.count) && day.count > 0 ? day.count : 0;
    byYear.set(year, months);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, months]) => ({ year, months }));
}

export function scoreFromYears(years: readonly YearMonths[]): number {
  let total = 0;
  for (const year of years) for (const value of year.months) total += value;
  return total;
}

/**
 * First year that must be refetched on an incremental run. During January the
 * previous year is refetched too, because GitHub can still add late events.
 */
export function refetchFromYear(now: Date): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() === 0 ? year - 1 : year;
}

export function mergeWithPrevious(
  previous: readonly YearMonths[],
  fresh: readonly YearMonths[],
  refetchedFrom: number,
): YearMonths[] {
  const kept = previous.filter((year) => year.year < refetchedFrom);
  const added = fresh.filter((year) => year.year >= refetchedFrom);
  return [...kept, ...added].sort((a, b) => a.year - b.year);
}

export function rankUsers(users: readonly UnrankedUser[], limit: number): RankedUser[] {
  const sorted = [...users].sort(
    (a, b) => b.score - a.score || a.login.localeCompare(b.login),
  );
  const ranked: RankedUser[] = [];
  for (let index = 0; index < sorted.length && index < limit; index += 1) {
    const user = sorted[index];
    const previous = ranked[index - 1];
    const rank = previous && previous.score === user.score ? previous.rank : index + 1;
    ranked.push({ ...user, rank });
  }
  return ranked;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/snapshot.ts tests/unit/snapshot.test.ts
git commit -m "Add ranking snapshot model and pure helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Snapshot validators and index builder

**Files:**
- Modify: `lib/rankings/snapshot.ts` (append)
- Test: `tests/unit/snapshot-validate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/snapshot-validate.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIndex,
  isCountrySnapshot,
  isRankingsIndex,
  type CountrySnapshot,
  type RankingsIndex,
} from "@/lib/rankings/snapshot";

const months = Array.from({ length: 12 }, (_, i) => i);

export const validSnapshot: CountrySnapshot = {
  version: 1,
  country: { slug: "germany", name: "Germany" },
  generatedAt: "2026-11-23T03:00:00.000Z",
  candidateCount: 2,
  users: [
    { rank: 1, id: 1, login: "a", name: "A", avatarUrl: "https://x/a.png", score: 66, years: [{ year: 2025, months }] },
  ],
};

test("accepts a well-formed snapshot", () => {
  assert.equal(isCountrySnapshot(validSnapshot), true);
});

test("rejects wrong version, missing fields, and bad month arrays", () => {
  assert.equal(isCountrySnapshot({ ...validSnapshot, version: 2 }), false);
  assert.equal(isCountrySnapshot({ ...validSnapshot, country: undefined }), false);
  assert.equal(isCountrySnapshot(null), false);
  const badMonths = structuredClone(validSnapshot);
  badMonths.users[0].years[0].months = [1, 2, 3];
  assert.equal(isCountrySnapshot(badMonths), false);
});

test("buildIndex replaces rebuilt countries and keeps the rest", () => {
  const previous: RankingsIndex = {
    version: 1,
    generatedAt: "2026-11-22T03:00:00.000Z",
    countries: [
      { slug: "germany", name: "Germany", updatedAt: "2026-11-22T03:00:00.000Z", userCount: 1, leader: null },
      { slug: "france", name: "France", updatedAt: "2026-11-22T03:00:00.000Z", userCount: 5, leader: null },
    ],
  };
  const index = buildIndex(previous, [validSnapshot], ["germany", "france", "japan"], new Date("2026-11-23T04:00:00.000Z"));
  assert.equal(isRankingsIndex(index), true);
  assert.deepEqual(index.countries.map((c) => c.slug), ["germany", "france"]);
  assert.equal(index.countries[0].updatedAt, "2026-11-23T03:00:00.000Z");
  assert.deepEqual(index.countries[0].leader, { login: "a", avatarUrl: "https://x/a.png", score: 66 });
  assert.equal(index.countries[1].userCount, 5);
  assert.equal(index.generatedAt, "2026-11-23T04:00:00.000Z");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL — `isCountrySnapshot` not exported.

- [ ] **Step 3: Implement**

Append to `lib/rankings/snapshot.ts`:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isYearMonths(value: unknown): value is YearMonths {
  return (
    isRecord(value) &&
    Number.isInteger(value.year) &&
    Array.isArray(value.months) &&
    value.months.length === 12 &&
    value.months.every(isNonNegativeNumber)
  );
}

function isRankedUser(value: unknown): value is RankedUser {
  return (
    isRecord(value) &&
    Number.isInteger(value.rank) &&
    Number.isInteger(value.id) &&
    typeof value.login === "string" &&
    (value.name === null || typeof value.name === "string") &&
    typeof value.avatarUrl === "string" &&
    isNonNegativeNumber(value.score) &&
    Array.isArray(value.years) &&
    value.years.every(isYearMonths)
  );
}

export function isCountrySnapshot(value: unknown): value is CountrySnapshot {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isRecord(value.country) &&
    typeof value.country.slug === "string" &&
    typeof value.country.name === "string" &&
    typeof value.generatedAt === "string" &&
    isNonNegativeNumber(value.candidateCount) &&
    Array.isArray(value.users) &&
    value.users.every(isRankedUser)
  );
}

function isIndexEntry(value: unknown): value is RankingsIndexEntry {
  if (!isRecord(value)) return false;
  const leader = value.leader;
  return (
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    typeof value.updatedAt === "string" &&
    isNonNegativeNumber(value.userCount) &&
    (leader === null ||
      (isRecord(leader) &&
        typeof leader.login === "string" &&
        typeof leader.avatarUrl === "string" &&
        isNonNegativeNumber(leader.score)))
  );
}

export function isRankingsIndex(value: unknown): value is RankingsIndex {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.generatedAt === "string" &&
    Array.isArray(value.countries) &&
    value.countries.every(isIndexEntry)
  );
}

function indexEntry(snapshot: CountrySnapshot): RankingsIndexEntry {
  const leader = snapshot.users[0];
  return {
    slug: snapshot.country.slug,
    name: snapshot.country.name,
    updatedAt: snapshot.generatedAt,
    userCount: snapshot.users.length,
    leader: leader
      ? { login: leader.login, avatarUrl: leader.avatarUrl, score: leader.score }
      : null,
  };
}

/**
 * Combine freshly built snapshots with the previous index. Countries are
 * listed in `order` (config order); a country with neither a fresh snapshot
 * nor a previous entry is omitted.
 */
export function buildIndex(
  previous: RankingsIndex | null,
  fresh: readonly CountrySnapshot[],
  order: readonly string[],
  now: Date,
): RankingsIndex {
  const bySlug = new Map<string, RankingsIndexEntry>();
  for (const entry of previous?.countries ?? []) bySlug.set(entry.slug, entry);
  for (const snapshot of fresh) bySlug.set(snapshot.country.slug, indexEntry(snapshot));
  return {
    version: 1,
    generatedAt: now.toISOString(),
    countries: order.flatMap((slug) => {
      const entry = bySlug.get(slug);
      return entry ? [entry] : [];
    }),
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/snapshot.ts tests/unit/snapshot-validate.test.ts
git commit -m "Validate ranking snapshots and build the country index

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Bed scale and "updated" text

**Files:**
- Create: `lib/rankings/bed-scale.ts`, `lib/rankings/format.ts`
- Test: `tests/unit/bed-scale.test.ts`, `tests/unit/format.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/bed-scale.test.ts`:

```ts
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
```

Create `tests/unit/format.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { formatUpdated, isStale } from "@/lib/rankings/format";

const now = new Date("2026-11-23T12:00:00.000Z");

test("formats recent updates in minutes, hours, and days", () => {
  assert.equal(formatUpdated("2026-11-23T11:58:00.000Z", now), "updated just now");
  assert.equal(formatUpdated("2026-11-23T11:20:00.000Z", now), "updated 40 minutes ago");
  assert.equal(formatUpdated("2026-11-23T09:00:00.000Z", now), "updated 3 hours ago");
  assert.equal(formatUpdated("2026-11-23T11:00:00.000Z", now), "updated 1 hour ago");
  assert.equal(formatUpdated("2026-11-20T12:00:00.000Z", now), "updated 3 days ago");
});

test("isStale after 48 hours", () => {
  assert.equal(isStale("2026-11-21T13:00:00.000Z", now), false);
  assert.equal(isStale("2026-11-21T11:00:00.000Z", now), true);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:unit`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `lib/rankings/bed-scale.ts`:

```ts
import type { YearMonths } from "./snapshot";

/** Largest single monthly count across every user on a board. */
export function boardScaleMax(users: ReadonlyArray<{ years: readonly YearMonths[] }>): number {
  let max = 0;
  for (const user of users) {
    for (const year of user.years) {
      for (const value of year.months) if (value > max) max = value;
    }
  }
  return max;
}

/** Normalised 0..1 stem value on a log scale shared by the whole board. */
export function stemValue(count: number, scaleMax: number): number {
  if (!(scaleMax > 0) || !(count > 0)) return 0;
  return Math.min(1, Math.log1p(count) / Math.log1p(scaleMax));
}
```

Create `lib/rankings/format.ts`:

```ts
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

export function formatUpdated(iso: string, now: Date = new Date()): string {
  const age = Math.max(0, now.getTime() - Date.parse(iso));
  if (age < 5 * MINUTE) return "updated just now";
  if (age < HOUR) return `updated ${plural(Math.floor(age / MINUTE), "minute")} ago`;
  if (age < DAY) return `updated ${plural(Math.floor(age / HOUR), "hour")} ago`;
  return `updated ${plural(Math.floor(age / DAY), "day")} ago`;
}

export function isStale(iso: string, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(iso) > 48 * HOUR;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/bed-scale.ts lib/rankings/format.ts tests/unit/bed-scale.test.ts tests/unit/format.test.ts
git commit -m "Add shared bed scale and relative-time formatting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Part B gate**

Run: `npm run typecheck && npm run lint && npm run test:unit`
Expected: all clean.

---

# Part C — Pipeline

### Task 9: Extract the shared GitHub GraphQL client

Pure move — behaviour must not change.

**Files:**
- Create: `lib/github/graphql.ts`
- Modify: `app/api/github/[username]/route.ts`

- [ ] **Step 1: Create the module by moving code out of the route**

Create `lib/github/graphql.ts` containing, moved verbatim from `app/api/github/[username]/route.ts` and each marked `export`:

- `const GITHUB_GRAPHQL_URL` and `const REQUEST_TIMEOUT_MS`
- `interface GraphQLResponse<T>`
- `class GitHubRequestError`
- `type GitHubAuthorizationKind` (extend it to `"oauth-app" | "server-token" | "user-session" | "rankings"`)
- `interface GitHubAuthorization`
- `async function fetchGraphQL<T>(...)`
- `async function mapWithConcurrency<T, R>(...)`
- `function chunk<T>(...)`

Add at the top of the new file: `import { logger } from "@/lib/logger";`

- [ ] **Step 2: Import them in the route**

In the route, delete the moved declarations and add:

```ts
import {
  GitHubRequestError,
  chunk,
  fetchGraphQL,
  mapWithConcurrency,
  type GitHubAuthorization,
} from "@/lib/github/graphql";
```

Keep `GitHubServerAuthorization`, `githubServerAuthorization()` and everything cache-related in the route.

- [ ] **Step 3: Verify nothing changed**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass, same test count as before.

- [ ] **Step 4: Commit**

```bash
git add lib/github/graphql.ts "app/api/github/[username]/route.ts"
git commit -m "Extract the GitHub GraphQL client from the API route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Candidate search

GitHub search returns at most 1,000 results per query and allows 30 search requests a minute. Each alias is searched by followers; the alias lists are merged round-robin (search results carry no follower counts, so this approximates "most followed first" without an extra request per user) and de-duplicated by id.

**Files:**
- Create: `lib/rankings/github-source.ts`
- Test: `tests/unit/search.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/search.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { searchCandidates } from "@/lib/rankings/github-source";

function fakeSearch(byAlias: Record<string, Array<{ id: number; login: string }>>) {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.searchParams.get("q") ?? "");
    const alias = /location:"([^"]+)"/.exec(url.searchParams.get("q") ?? "")?.[1] ?? "";
    const page = Number(url.searchParams.get("page"));
    const perPage = Number(url.searchParams.get("per_page"));
    const items = (byAlias[alias] ?? []).slice((page - 1) * perPage, page * perPage);
    return Response.json({ total_count: byAlias[alias]?.length ?? 0, items });
  };
  return { calls, fetchImpl };
}

test("merges aliases round-robin, de-duplicates, and stops at the limit", async () => {
  const { calls, fetchImpl } = fakeSearch({
    Berlin: [{ id: 1, login: "b1" }, { id: 2, login: "b2" }, { id: 3, login: "b3" }],
    Germany: [{ id: 2, login: "b2" }, { id: 9, login: "g9" }],
  });
  const users = await searchCandidates(["Berlin", "Germany"], 4, {
    token: "t",
    fetchImpl,
    sleep: async () => {},
  });
  assert.deepEqual(users.map((u) => u.login), ["b1", "b2", "g9", "b3"]);
  assert.ok(calls.every((q) => q.includes("followers:>10") && q.includes("type:user")));
});

test("throttles between search requests", async () => {
  const { fetchImpl } = fakeSearch({ A: [{ id: 1, login: "a" }], B: [{ id: 2, login: "b" }] });
  const waits: number[] = [];
  await searchCandidates(["A", "B"], 10, {
    token: "t",
    fetchImpl,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.deepEqual(waits, [2100]);
});

test("fails loudly on an auth error", async () => {
  await assert.rejects(
    searchCandidates(["A"], 10, {
      token: "bad",
      fetchImpl: async () => new Response("{}", { status: 401 }),
      sleep: async () => {},
    }),
    /GitHub search failed with status 401/,
  );
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/rankings/github-source.ts`:

```ts
export interface SearchUser {
  id: number;
  login: string;
}

export interface SearchDeps {
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const SEARCH_URL = "https://api.github.com/search/users";
const SEARCH_PAGE_SIZE = 100;
const SEARCH_RESULT_CAP = 1_000;
/** 30 search requests per minute → one every 2 s, plus a margin. */
export const SEARCH_THROTTLE_MS = 2_100;

export const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function searchAlias(
  alias: string,
  maxResults: number,
  deps: Required<SearchDeps>,
  throttle: () => Promise<void>,
): Promise<SearchUser[]> {
  const results: SearchUser[] = [];
  const pages = Math.ceil(Math.min(maxResults, SEARCH_RESULT_CAP) / SEARCH_PAGE_SIZE);
  for (let page = 1; page <= pages; page += 1) {
    await throttle();
    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", `location:"${alias}" followers:>10 type:user`);
    url.searchParams.set("sort", "followers");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", String(SEARCH_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    const response = await deps.fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${deps.token}`,
        "User-Agent": "Contribution-Garden-Rankings",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub search failed with status ${response.status} for "${alias}".`);
    }
    const body = (await response.json()) as { items?: Array<{ id: number; login: string }> };
    const items = body.items ?? [];
    for (const item of items) results.push({ id: item.id, login: item.login });
    if (items.length < SEARCH_PAGE_SIZE) break;
  }
  return results;
}

export async function searchCandidates(
  aliases: readonly string[],
  limit: number,
  deps: SearchDeps,
): Promise<SearchUser[]> {
  const resolved: Required<SearchDeps> = {
    token: deps.token,
    fetchImpl: deps.fetchImpl ?? fetch,
    sleep: deps.sleep ?? defaultSleep,
  };
  let first = true;
  const throttle = async () => {
    if (!first) await resolved.sleep(SEARCH_THROTTLE_MS);
    first = false;
  };

  const lists: SearchUser[][] = [];
  for (const alias of aliases) {
    lists.push(await searchAlias(alias, limit, resolved, throttle));
  }

  const seen = new Set<number>();
  const merged: SearchUser[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let position = 0; position < longest && merged.length < limit; position += 1) {
    for (const list of lists) {
      const user = list[position];
      if (!user || seen.has(user.id)) continue;
      seen.add(user.id);
      merged.push(user);
      if (merged.length >= limit) break;
    }
  }
  return merged;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/github-source.ts tests/unit/search.test.ts
git commit -m "Search GitHub for leaderboard candidates by location

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Per-user history fetch with rate-limit pausing

One query gets the profile, `contributionYears`, the rate limit, and the years from `fromYear` (or the most recent 2 years for a new user). New users then get their remaining years in chunks of 8.

**Files:**
- Modify: `lib/rankings/github-source.ts` (append)
- Test: `tests/unit/user-history.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/user-history.test.ts`:

```ts
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { fetchUserHistory } from "@/lib/rankings/github-source";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function calendar(year: number, count: number) {
  return {
    contributionCalendar: {
      weeks: [{ contributionDays: [{ date: `${year}-03-04`, contributionCount: count }] }],
    },
  };
}

function stubGraphQL(contributionYears: number[], remaining = 4_000) {
  const queries: string[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const query = String(JSON.parse(String(init?.body)).query);
    queries.push(query);
    const years = [...query.matchAll(/y(\d{4}): contributionsCollection/g)].map((m) => Number(m[1]));
    return Response.json({
      data: {
        rateLimit: { remaining, resetAt: "2026-11-23T11:00:00Z" },
        user: {
          databaseId: 42,
          login: "Mia",
          name: "Mia S",
          avatarUrl: "https://a/42",
          contributionsCollection: { contributionYears },
          ...Object.fromEntries(years.map((y) => [`y${y}`, calendar(y, y - 2000)])),
        },
      },
    });
  }) as typeof fetch;
  return queries;
}

const now = new Date("2026-11-23T10:00:00.000Z");

test("new user: fetches the latest two years, then the rest in chunks of 8", async () => {
  const queries = stubGraphQL([2026, 2025, 2024, 2015, 2010]);
  const result = await fetchUserHistory("mia", null, now, { token: "t", sleep: async () => {} });
  assert.ok(result);
  assert.equal(result.id, 42);
  assert.equal(result.login, "Mia");
  assert.deepEqual(result.years.map((y) => y.year), [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert.equal(result.years.at(-1)?.months[2], 26);
  assert.equal(queries.length, 3);
});

test("known user: only the requested years", async () => {
  const queries = stubGraphQL([2026, 2025]);
  const result = await fetchUserHistory("mia", 2026, now, { token: "t", sleep: async () => {} });
  assert.deepEqual(result?.years.map((y) => y.year), [2026]);
  assert.equal(queries.length, 1);
});

test("returns null for a user that no longer exists", async () => {
  globalThis.fetch = (async () =>
    Response.json({ errors: [{ type: "NOT_FOUND", message: "Could not resolve to a User" }] })) as typeof fetch;
  assert.equal(await fetchUserHistory("gone", null, now, { token: "t", sleep: async () => {} }), null);
});

test("sleeps until reset when the rate limit runs low", async () => {
  stubGraphQL([2026], 150);
  const waits: number[] = [];
  await fetchUserHistory("mia", 2026, now, {
    token: "t",
    sleep: async (ms) => {
      waits.push(ms);
    },
    now: () => new Date("2026-11-23T10:59:00Z"),
  });
  assert.deepEqual(waits, [65_000]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL — `fetchUserHistory` not exported.

- [ ] **Step 3: Implement**

Append to `lib/rankings/github-source.ts`:

```ts
import { GitHubRequestError, chunk, fetchGraphQL, type GitHubAuthorization } from "@/lib/github/graphql";
import { yearRange } from "@/lib/github/history-query";
import { rollUpMonths, type DailyCount, type YearMonths } from "./snapshot";

export interface FetchedUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  /** Only the years that were fetched, oldest first. */
  years: YearMonths[];
}

export interface HistoryDeps {
  token: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const HISTORY_CHUNK = 8;
const RATE_LIMIT_FLOOR = 200;
const RESET_MARGIN_MS = 5_000;

interface RawHistory {
  rateLimit: { remaining: number; resetAt: string };
  user:
    | ({
        databaseId: number;
        login: string;
        name: string | null;
        avatarUrl: string;
        contributionsCollection: { contributionYears: number[] };
      } & Record<string, unknown>)
    | null;
}

interface RawYear {
  contributionCalendar: {
    weeks: Array<{ contributionDays: Array<{ date: string; contributionCount: number }> }>;
  };
}

function historyQuery(years: readonly number[], now: Date): string {
  const selections = years
    .map((year) => {
      const { from, to } = yearRange(year, now);
      return `y${year}: contributionsCollection(from: "${from}", to: "${to}") {
        contributionCalendar { weeks { contributionDays { date contributionCount } } }
      }`;
    })
    .join("\n");
  return `query RankingHistory($login: String!) {
    rateLimit { remaining resetAt }
    user(login: $login) {
      databaseId login name avatarUrl
      contributionsCollection { contributionYears }
      ${selections}
    }
  }`;
}

function yearsBetween(from: number, to: number): number[] {
  const years: number[] = [];
  for (let year = from; year <= to; year += 1) years.push(year);
  return years;
}

export async function fetchUserHistory(
  login: string,
  fromYear: number | null,
  now: Date,
  deps: HistoryDeps,
): Promise<FetchedUser | null> {
  const sleep = deps.sleep ?? defaultSleep;
  const clock = deps.now ?? (() => new Date());
  const authorization: GitHubAuthorization = {
    header: `Bearer ${deps.token}`,
    kind: "rankings",
    cacheScope: "rankings",
  };
  const currentYear = now.getUTCFullYear();

  const run = async (years: number[]): Promise<RawHistory> => {
    const data = await fetchGraphQL<RawHistory>(authorization, historyQuery(years, now), { login });
    if (data.rateLimit.remaining < RATE_LIMIT_FLOOR) {
      const wait = Date.parse(data.rateLimit.resetAt) - clock().getTime() + RESET_MARGIN_MS;
      if (wait > 0) await sleep(wait);
    }
    return data;
  };

  const days: DailyCount[] = [];
  const collect = (data: RawHistory, years: number[]) => {
    for (const year of years) {
      const raw = data.user?.[`y${year}`] as RawYear | undefined;
      for (const week of raw?.contributionCalendar.weeks ?? []) {
        for (const day of week.contributionDays) {
          days.push({ date: day.date, count: day.contributionCount });
        }
      }
    }
  };

  const firstYears = yearsBetween(fromYear ?? currentYear - 1, currentYear);
  let first: RawHistory;
  try {
    first = await run(firstYears);
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) return null;
    throw error;
  }
  if (!first.user) return null;
  collect(first, firstYears);

  if (fromYear === null) {
    const earliest = Math.min(currentYear, ...first.user.contributionsCollection.contributionYears);
    const remaining = yearsBetween(earliest, firstYears[0] - 1);
    for (const years of chunk(remaining, HISTORY_CHUNK)) {
      collect(await run(years), years);
    }
  }

  const unique = new Map(days.map((day) => [day.date, day]));
  const fetchedFrom = fromYear ?? Math.min(currentYear, ...first.user.contributionsCollection.contributionYears);
  const rolled = rollUpMonths([...unique.values()]);
  const byYear = new Map(rolled.map((year) => [year.year, year]));
  return {
    id: first.user.databaseId,
    login: first.user.login,
    name: first.user.name,
    avatarUrl: first.user.avatarUrl,
    years: yearsBetween(fetchedFrom, currentYear).map(
      (year) => byYear.get(year) ?? { year, months: Array.from({ length: 12 }, () => 0) },
    ),
  };
}
```

Move the three new `import` lines to the top of the file with any existing imports.

Note: empty years between the first and last active year are kept (all-zero months) so the board shows gaps as empty beds.

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/github-source.ts tests/unit/user-history.test.ts
git commit -m "Fetch per-user monthly history for rankings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Snapshot stores (local directory and Vercel Blob)

**Files:**
- Modify: `package.json` (dependency)
- Create: `lib/rankings/snapshot-store.ts`
- Test: `tests/unit/snapshot-store.test.ts`

- [ ] **Step 1: Install the Blob SDK**

Run: `npm install @vercel/blob@1.1.1`
Expected: added to `dependencies`. (If 1.1.1 is unavailable, use the newest 1.x and confirm `put` accepts `allowOverwrite` in `node_modules/@vercel/blob/dist/index.d.ts`.)

- [ ] **Step 2: Write the failing test**

Create `tests/unit/snapshot-store.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { directoryStore } from "@/lib/rankings/snapshot-store";

test("directory store round-trips JSON and returns null for missing files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rankings-"));
  try {
    const store = directoryStore(dir);
    assert.equal(await store.read("rankings/germany.json"), null);
    await store.write("rankings/germany.json", { ok: true });
    assert.deepEqual(await store.read("rankings/germany.json"), { ok: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `lib/rankings/snapshot-store.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";

export interface SnapshotStore {
  read(pathname: string): Promise<unknown | null>;
  write(pathname: string, data: unknown): Promise<void>;
}

export function directoryStore(root: string): SnapshotStore {
  return {
    async read(pathname) {
      try {
        return JSON.parse(await readFile(path.join(root, pathname), "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async write(pathname, data) {
      const target = path.join(root, pathname);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(data)}\n`);
    },
  };
}

export function blobStore(options: { token: string; baseUrl: string }): SnapshotStore {
  const base = options.baseUrl.replace(/\/+$/, "");
  return {
    async read(pathname) {
      const response = await fetch(`${base}/${pathname}?t=${Date.now()}`, { cache: "no-store" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Blob read failed (${response.status}) for ${pathname}`);
      return response.json();
    },
    async write(pathname, data) {
      await put(pathname, JSON.stringify(data), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 300,
        token: options.token,
      });
    },
  };
}
```

The `?t=` query bypasses the Blob CDN cache so the builder always reads its own latest write.

- [ ] **Step 5: Run it to see it pass, and typecheck**

Run: `npm run test:unit && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/rankings/snapshot-store.ts tests/unit/snapshot-store.test.ts
git commit -m "Add local and Vercel Blob snapshot stores

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Build one country

**Files:**
- Create: `lib/rankings/build.ts`
- Test: `tests/unit/build.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/build.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildCountry, orderCountriesByStaleness } from "@/lib/rankings/build";
import type { FetchedUser } from "@/lib/rankings/github-source";
import { isCountrySnapshot, type CountrySnapshot, type RankingsIndex } from "@/lib/rankings/snapshot";
import type { SnapshotStore } from "@/lib/rankings/snapshot-store";

function memoryStore(initial: Record<string, unknown> = {}): SnapshotStore & { files: Record<string, unknown> } {
  const files = { ...initial };
  return {
    files,
    async read(p) {
      return files[p] ?? null;
    },
    async write(p, data) {
      files[p] = data;
    },
  };
}

const months = (value: number) => Array.from({ length: 12 }, () => value);
const germany = { slug: "germany", name: "Germany", aliases: ["Berlin"] };
const now = new Date("2026-11-23T03:00:00.000Z");

test("builds ranked public and candidate snapshots", async () => {
  const store = memoryStore();
  const fetched: Record<string, FetchedUser | null> = {
    small: { id: 1, login: "small", name: null, avatarUrl: "a", years: [{ year: 2026, months: months(1) }] },
    big: { id: 2, login: "big", name: "Big", avatarUrl: "b", years: [{ year: 2026, months: months(10) }] },
    gone: null,
  };
  const snapshot = await buildCountry(germany, {
    store,
    now,
    candidateLimit: 10,
    publicLimit: 1,
    search: async () => [
      { id: 1, login: "small" },
      { id: 2, login: "big" },
      { id: 3, login: "gone" },
    ],
    fetchUser: async (login) => fetched[login],
    log: () => {},
  });
  assert.equal(isCountrySnapshot(snapshot), true);
  assert.deepEqual(snapshot.users.map((u) => [u.login, u.rank, u.score]), [["big", 1, 120]]);
  const candidates = store.files["rankings/germany.candidates.json"] as CountrySnapshot;
  assert.equal(candidates.users.length, 2);
  assert.equal(snapshot.candidateCount, 2);
  assert.ok(store.files["rankings/germany.json"]);
});

test("reuses stored past years for known users", async () => {
  const previous: CountrySnapshot = {
    version: 1,
    country: { slug: "germany", name: "Germany" },
    generatedAt: "2026-11-22T03:00:00.000Z",
    candidateCount: 1,
    users: [{ rank: 1, id: 7, login: "old", name: null, avatarUrl: "x", score: 0, years: [{ year: 2020, months: months(5) }] }],
  };
  const store = memoryStore({ "rankings/germany.candidates.json": previous });
  const requested: Array<number | null> = [];
  const snapshot = await buildCountry(germany, {
    store,
    now,
    candidateLimit: 10,
    publicLimit: 10,
    search: async () => [{ id: 7, login: "old" }],
    fetchUser: async (_login, fromYear) => {
      requested.push(fromYear);
      return { id: 7, login: "old", name: null, avatarUrl: "x", years: [{ year: 2026, months: months(1) }] };
    },
    log: () => {},
  });
  assert.deepEqual(requested, [2026]);
  assert.deepEqual(snapshot.users[0].years.map((y) => y.year), [2020, 2026]);
  assert.equal(snapshot.users[0].score, 72);
});

test("a single failing user is skipped, an auth failure aborts", async () => {
  const store = memoryStore();
  const base = {
    store,
    now,
    candidateLimit: 10,
    publicLimit: 10,
    search: async () => [{ id: 1, login: "boom" }],
    log: () => {},
  };
  const skipped = await buildCountry(germany, { ...base, fetchUser: async () => { throw new Error("weird"); } });
  assert.equal(skipped.users.length, 0);
  const authError = Object.assign(new Error("bad credentials"), { status: 401 });
  await assert.rejects(buildCountry(germany, { ...base, fetchUser: async () => { throw authError; } }), /bad credentials/);
});

test("orders countries never built first, then oldest", () => {
  const index: RankingsIndex = {
    version: 1,
    generatedAt: "x",
    countries: [
      { slug: "a", name: "A", updatedAt: "2026-11-22T00:00:00Z", userCount: 1, leader: null },
      { slug: "b", name: "B", updatedAt: "2026-11-20T00:00:00Z", userCount: 1, leader: null },
    ],
  };
  const order = orderCountriesByStaleness(
    [
      { slug: "a", name: "A", aliases: [] },
      { slug: "b", name: "B", aliases: [] },
      { slug: "c", name: "C", aliases: [] },
    ],
    index,
  );
  assert.deepEqual(order.map((c) => c.slug), ["c", "b", "a"]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/rankings/build.ts`:

```ts
import { mapWithConcurrency } from "@/lib/github/graphql";
import type { CountryConfig } from "./countries";
import type { FetchedUser, SearchUser } from "./github-source";
import {
  isCountrySnapshot,
  mergeWithPrevious,
  rankUsers,
  refetchFromYear,
  scoreFromYears,
  type CountrySnapshot,
  type RankingsIndex,
  type UnrankedUser,
} from "./snapshot";
import type { SnapshotStore } from "./snapshot-store";

export interface BuildDeps {
  store: SnapshotStore;
  now: Date;
  candidateLimit: number;
  publicLimit: number;
  search: (aliases: readonly string[], limit: number) => Promise<SearchUser[]>;
  fetchUser: (login: string, fromYear: number | null, now: Date) => Promise<FetchedUser | null>;
  log: (message: string) => void;
  concurrency?: number;
}

export const candidatesPath = (slug: string) => `rankings/${slug}.candidates.json`;
export const publicPath = (slug: string) => `rankings/${slug}.json`;
export const INDEX_PATH = "rankings/index.json";

function isFatal(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  return status === 401 || status === 429;
}

export async function buildCountry(country: CountryConfig, deps: BuildDeps): Promise<CountrySnapshot> {
  const previousRaw = await deps.store.read(candidatesPath(country.slug));
  const previous = isCountrySnapshot(previousRaw) ? previousRaw : null;
  const previousById = new Map(previous?.users.map((user) => [user.id, user]));
  const refetchFrom = refetchFromYear(deps.now);

  const candidates = await deps.search(country.aliases, deps.candidateLimit);
  deps.log(`${country.slug}: ${candidates.length} candidates`);

  const results = await mapWithConcurrency(candidates, deps.concurrency ?? 4, async (candidate) => {
    const known = previousById.get(candidate.id);
    try {
      const fetched = await deps.fetchUser(candidate.login, known ? refetchFrom : null, deps.now);
      if (!fetched) return null;
      const years = known ? mergeWithPrevious(known.years, fetched.years, refetchFrom) : fetched.years;
      const user: UnrankedUser = {
        id: fetched.id,
        login: fetched.login,
        name: fetched.name,
        avatarUrl: fetched.avatarUrl,
        years,
        score: scoreFromYears(years),
      };
      return user;
    } catch (error) {
      if (isFatal(error)) throw error;
      deps.log(`${country.slug}: skipped ${candidate.login} (${(error as Error).message})`);
      return null;
    }
  });

  const users = results.filter((user): user is UnrankedUser => user !== null);
  const ranked = rankUsers(users, users.length);
  const base = {
    version: 1 as const,
    country: { slug: country.slug, name: country.name },
    generatedAt: deps.now.toISOString(),
    candidateCount: users.length,
  };
  await deps.store.write(candidatesPath(country.slug), { ...base, users: ranked });
  const snapshot: CountrySnapshot = { ...base, users: ranked.slice(0, deps.publicLimit) };
  await deps.store.write(publicPath(country.slug), snapshot);
  return snapshot;
}

/** Countries with no snapshot first, then least recently updated. */
export function orderCountriesByStaleness(
  countries: readonly CountryConfig[],
  index: RankingsIndex | null,
): CountryConfig[] {
  const updated = new Map(index?.countries.map((entry) => [entry.slug, Date.parse(entry.updatedAt)]));
  // A finite sentinel: (-Infinity) - (-Infinity) would be NaN and break sort.
  const time = (slug: string) => updated.get(slug) ?? Number.MIN_SAFE_INTEGER;
  return [...countries].sort((a, b) => time(a.slug) - time(b.slug));
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/build.ts tests/unit/build.test.ts
git commit -m "Build a country's ranking snapshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The build-rankings CLI

**Files:**
- Create: `scripts/build-rankings.ts`
- Modify: `package.json` (script)

- [ ] **Step 1: Write the script**

Create `scripts/build-rankings.ts`:

```ts
import { parseArgs } from "node:util";
import { COUNTRIES, findCountry } from "@/lib/rankings/countries";
import { INDEX_PATH, buildCountry, orderCountriesByStaleness } from "@/lib/rankings/build";
import { fetchUserHistory, searchCandidates } from "@/lib/rankings/github-source";
import { buildIndex, isRankingsIndex, type CountrySnapshot } from "@/lib/rankings/snapshot";
import { blobStore, directoryStore } from "@/lib/rankings/snapshot-store";

const CANDIDATE_LIMIT = 1_000;
const PUBLIC_LIMIT = 256;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      country: { type: "string" },
      limit: { type: "string" },
      out: { type: "string" },
    },
  });

  const token = process.env.RANKINGS_GITHUB_TOKEN?.trim();
  if (!token) {
    console.error("RANKINGS_GITHUB_TOKEN is not set.");
    return 1;
  }

  let store;
  if (values.out) {
    store = directoryStore(values.out);
  } else {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    const baseUrl = process.env.RANKINGS_BASE_URL?.trim();
    if (!blobToken || !baseUrl) {
      console.error("Set BLOB_READ_WRITE_TOKEN and RANKINGS_BASE_URL, or pass --out <dir>.");
      return 1;
    }
    store = blobStore({ token: blobToken, baseUrl });
  }

  const selected = values.country ? findCountry(values.country) : undefined;
  if (values.country && !selected) {
    console.error(`Unknown country "${values.country}".`);
    return 1;
  }
  const candidateLimit = values.limit ? Number(values.limit) : CANDIDATE_LIMIT;

  const previousRaw = await store.read(INDEX_PATH);
  let index = isRankingsIndex(previousRaw) ? previousRaw : null;
  const queue = selected ? [selected] : orderCountriesByStaleness(COUNTRIES, index);
  const order = COUNTRIES.map((country) => country.slug);
  let failures = 0;

  for (const country of queue) {
    const startedAt = Date.now();
    try {
      const snapshot: CountrySnapshot = await buildCountry(country, {
        store,
        now: new Date(),
        candidateLimit,
        publicLimit: PUBLIC_LIMIT,
        search: (aliases, limit) => searchCandidates(aliases, limit, { token }),
        fetchUser: (login, fromYear, now) => fetchUserHistory(login, fromYear, now, { token }),
        log: (message) => console.log(message),
      });
      index = buildIndex(index, [snapshot], order, new Date());
      await store.write(INDEX_PATH, index);
      console.log(
        `${country.slug}: ${snapshot.users.length} ranked in ${Math.round((Date.now() - startedAt) / 1000)}s`,
      );
    } catch (error) {
      failures += 1;
      console.error(`${country.slug}: failed — ${(error as Error).message}`);
    }
  }

  return failures > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
```

The index is rewritten after each country, so a run cut off by the Action timeout still publishes every finished country.

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"`, add:

```json
    "rankings:build": "tsx scripts/build-rankings.ts",
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Dry run against the real API**

Requires a GitHub personal access token with no scopes in the shell (ask the user to export it; never write it to a file):

```bash
RANKINGS_GITHUB_TOKEN="$RANKINGS_GITHUB_TOKEN" npm run rankings:build -- --country netherlands --limit 20 --out ./tmp/rankings
```

Expected: logs `netherlands: 20 candidates`, then `netherlands: <n> ranked in <s>s`, exit code 0. Then:

```bash
node --import tsx -e "import('./lib/rankings/snapshot.ts').then(async (m) => { const fs = await import('node:fs/promises'); const s = JSON.parse(await fs.readFile('tmp/rankings/rankings/netherlands.json','utf8')); console.log(m.isCountrySnapshot(s), s.users.length, s.users[0]?.login, s.users[0]?.score); })"
```

Expected: `true <n> <login> <score>` with a plausible score (thousands for the top user).

Run it a second time and check the log shows it finishing much faster (incremental refetch of 2026 only).

- [ ] **Step 5: Ignore local output and commit**

Append `/tmp/` to `.gitignore`.

```bash
git add scripts/build-rankings.ts package.json .gitignore
git commit -m "Add the build-rankings CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Daily GitHub Action

**Files:**
- Create: `.github/workflows/rankings.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/rankings.yml`:

```yaml
name: Build rankings

on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:
    inputs:
      country:
        description: "Country slug to rebuild (empty = all)"
        required: false
        default: ""

concurrency:
  group: rankings
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 350
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.13.0
          cache: npm
      - run: npm ci
      - name: Build and upload rankings
        env:
          RANKINGS_GITHUB_TOKEN: ${{ secrets.RANKINGS_GITHUB_TOKEN }}
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}
          RANKINGS_BASE_URL: ${{ vars.RANKINGS_BASE_URL }}
          COUNTRY: ${{ github.event.inputs.country }}
        run: |
          if [ -n "$COUNTRY" ]; then
            npm run rankings:build -- --country "$COUNTRY"
          else
            npm run rankings:build
          fi
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/rankings.yml
git commit -m "Run the rankings build daily

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Part C gate**

Run: `npm run typecheck && npm run lint && npm run test:unit && npm test`
Expected: all pass.

Setup the user does once (do not do this for them; list it in the final report): create a Vercel Blob store, add repo secrets `RANKINGS_GITHUB_TOKEN` and `BLOB_READ_WRITE_TOKEN`, add repo variable `RANKINGS_BASE_URL` (the store's public base URL, e.g. `https://<id>.public.blob.vercel-storage.com`), and add `RANKINGS_BASE_URL` to the Vercel project env.

---

# Part D — Site

### Task 16: Server-side snapshot reader

**Files:**
- Create: `lib/rankings/store.ts`
- Test: `tests/unit/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/store.test.ts`:

```ts
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { clearRankingsCache, getCountrySnapshot, getRankingsIndex } from "@/lib/rankings/store";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.RANKINGS_BASE_URL;
  clearRankingsCache();
});

const snapshot = {
  version: 1,
  country: { slug: "germany", name: "Germany" },
  generatedAt: "2026-11-23T03:00:00.000Z",
  candidateCount: 0,
  users: [],
};

test("returns null when no base URL is configured", async () => {
  assert.equal(await getRankingsIndex(), null);
});

test("reads, validates, and caches a country snapshot", async () => {
  process.env.RANKINGS_BASE_URL = "https://blob.test/";
  let calls = 0;
  globalThis.fetch = (async (input: unknown) => {
    calls += 1;
    assert.equal(String(input), "https://blob.test/rankings/germany.json");
    return Response.json(snapshot);
  }) as typeof fetch;
  assert.equal((await getCountrySnapshot("germany"))?.country.name, "Germany");
  await getCountrySnapshot("germany");
  assert.equal(calls, 1);
});

test("treats 404 and invalid JSON shapes as missing", async () => {
  process.env.RANKINGS_BASE_URL = "https://blob.test";
  globalThis.fetch = (async (input: unknown) =>
    String(input).endsWith("france.json")
      ? new Response("nope", { status: 404 })
      : Response.json({ version: 9 })) as typeof fetch;
  assert.equal(await getCountrySnapshot("france"), null);
  assert.equal(await getCountrySnapshot("japan"), null);
});

test("network errors are treated as missing", async () => {
  process.env.RANKINGS_BASE_URL = "https://blob.test";
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  assert.equal(await getRankingsIndex(), null);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/rankings/store.ts`:

```ts
import { logger } from "@/lib/logger";
import {
  isCountrySnapshot,
  isRankingsIndex,
  type CountrySnapshot,
  type RankingsIndex,
} from "./snapshot";

const TTL_MS = 10 * 60 * 1_000;
const cache = new Map<string, { value: unknown; expires: number }>();

export function clearRankingsCache() {
  cache.clear();
}

async function readJson(pathname: string): Promise<unknown | null> {
  const base = process.env.RANKINGS_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return null;
  const url = `${base}/${pathname}`;
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;

  let value: unknown = null;
  try {
    const response = await fetch(url);
    if (response.ok) value = await response.json();
    else if (response.status !== 404) {
      logger.warn("rankings_read_failed", { pathname, status: response.status });
    }
  } catch (error) {
    logger.warn("rankings_read_error", { pathname, message: (error as Error).message });
  }
  cache.set(url, { value, expires: Date.now() + TTL_MS });
  return value;
}

export async function getRankingsIndex(): Promise<RankingsIndex | null> {
  const value = await readJson("rankings/index.json");
  return isRankingsIndex(value) ? value : null;
}

export async function getCountrySnapshot(slug: string): Promise<CountrySnapshot | null> {
  const value = await readJson(`rankings/${slug}.json`);
  return isCountrySnapshot(value) ? value : null;
}
```

Check `lib/logger.ts` exports `logger.warn(event, fields)` — it is used this way in the GitHub route.

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/store.ts tests/unit/store.test.ts
git commit -m "Read ranking snapshots on the server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Year beds SVG

**Files:**
- Create: `components/leaderboard/YearBeds.tsx`
- Test: `tests/unit/year-beds.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/year-beds.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL — module not found. (If tsx complains about JSX, confirm `tsconfig.json` has `"jsx": "react-jsx"` — it does.)

- [ ] **Step 3: Implement**

Create `components/leaderboard/YearBeds.tsx`:

```tsx
import { stemValue } from "@/lib/rankings/bed-scale";
import { formatCount } from "@/lib/rankings/format";
import type { YearMonths } from "@/lib/rankings/snapshot";

const GREENS = ["#C0DD97", "#97C459", "#639922", "#3B6D11"] as const;
const FLOWERS = ["#ED93B1", "#EF9F27", "#7F77DD"] as const;
const SOIL = "#888780";

const WIDTH = 420;
const HEIGHT = 56;
const GROUND = HEIGHT - 8;
const MAX_STEM = GROUND - 6;
const GAP = 4;
const PAD = 5;
const MAX_BED = 36;

export interface YearBedsProps {
  years: readonly YearMonths[];
  scaleMax: number;
  className?: string;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function YearBeds({ years, scaleMax, className }: YearBedsProps) {
  const total = years.reduce((acc, year) => acc + sum(year.months), 0);
  const label =
    years.length === 0
      ? "No contributions yet"
      : `${years[0].year}–${years[years.length - 1].year}: ${formatCount(total)} contributions`;
  const count = Math.max(1, years.length);
  const bedWidth = Math.min(MAX_BED, (WIDTH - PAD * 2 - GAP * (count - 1)) / count);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
      className={className}
      preserveAspectRatio="xMinYMid meet"
    >
      {years.map((year, yearIndex) => {
        const x0 = PAD + yearIndex * (bedWidth + GAP);
        const values = year.months.map((value) => stemValue(value, scaleMax));
        const peak = values.indexOf(Math.max(...values));
        return (
          <g key={year.year}>
            <title>{`${year.year} · ${formatCount(sum(year.months))} contributions`}</title>
            <rect x={x0} y={GROUND} width={bedWidth} height={6} rx={2} fill={SOIL} />
            {values.map((value, month) => {
              if (value <= 0) return null;
              const x = x0 + 1.5 + (month * (bedWidth - 3)) / 11;
              const top = GROUND - (3 + value * (MAX_STEM - 3));
              return (
                <line
                  key={month}
                  x1={x}
                  y1={GROUND}
                  x2={x}
                  y2={top}
                  stroke={GREENS[Math.min(3, Math.floor(value * 4))]}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
              );
            })}
            {values[peak] > 0.5 ? (
              <circle
                cx={x0 + 1.5 + (peak * (bedWidth - 3)) / 11}
                cy={GROUND - (3 + values[peak] * (MAX_STEM - 3))}
                r={2.4}
                fill={FLOWERS[yearIndex % FLOWERS.length]}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:unit`
Expected: PASS. If the `aria-label` en dash is escaped differently by React, match on `2024` and `908 contributions` separately rather than changing the component.

- [ ] **Step 5: Commit**

```bash
git add components/leaderboard/YearBeds.tsx tests/unit/year-beds.test.tsx
git commit -m "Draw year-bed gardens as SVG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Country board page

**Files:**
- Create: `components/leaderboard/Board.tsx`, `components/leaderboard/leaderboard.css`
- Create: `app/country/[slug]/page.tsx`

- [ ] **Step 1: Board component (client — owns the filter)**

Create `components/leaderboard/Board.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCount } from "@/lib/rankings/format";
import type { RankedUser } from "@/lib/rankings/snapshot";
import { YearBeds } from "./YearBeds";

export interface BoardProps {
  slug: string;
  users: RankedUser[];
  scaleMax: number;
}

export function Board({ slug, users, scaleMax }: BoardProps) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (user) =>
        user.login.toLowerCase().includes(needle) ||
        (user.name ?? "").toLowerCase().includes(needle),
    );
  }, [filter, users]);

  return (
    <section className="board" aria-label="Ranked gardeners">
      <input
        className="board__filter"
        type="search"
        placeholder="Filter by username"
        aria-label="Filter by username"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      {visible.length === 0 ? (
        <p className="board__empty">No gardeners match &lsquo;{filter.trim()}&rsquo;.</p>
      ) : (
        <ol className="board__list">
          {visible.map((user) => (
            <li key={user.id}>
              <Link className="board__row" href={`/u/${user.login}?from=${slug}`}>
                <span className="board__rank">{user.rank}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="board__avatar" src={`${user.avatarUrl}&s=64`} alt="" width={32} height={32} loading="lazy" />
                <span className="board__name">
                  {user.name ?? user.login}
                  <small>@{user.login}</small>
                </span>
                <span className="board__score">
                  {formatCount(user.score)}
                  <small>lifetime</small>
                </span>
                <YearBeds className="board__beds" years={user.years} scaleMax={scaleMax} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

GitHub avatar URLs already contain a `?`; if a URL has none, `&s=64` is harmless but unneeded — leave as is.

- [ ] **Step 2: Styles**

Create `components/leaderboard/leaderboard.css`:

```css
.board-page {
  min-height: 100svh;
  padding: 32px 16px 64px;
  color: #f3f0e7;
  background: #0d1511;
}

.board-page__inner {
  max-width: 960px;
  margin: 0 auto;
}

.board-page__back {
  color: #b9c8c2;
  font-size: 13px;
  text-decoration: none;
}

.board-page__back:hover {
  color: #f3f0e7;
}

.board-page h1 {
  margin: 8px 0 4px;
  font-family: var(--font-newsreader), serif;
  font-size: clamp(32px, 6vw, 48px);
  font-weight: 500;
}

.board-page__meta,
.board-page__stale {
  margin: 0;
  color: #b9c8c2;
  font-size: 14px;
}

.board-page__stale {
  color: #e0b96e;
}

.board-page__empty {
  margin-top: 48px;
  color: #b9c8c2;
  font-size: 16px;
}

.board {
  margin-top: 24px;
}

.board__filter {
  width: 100%;
  max-width: 320px;
  height: 40px;
  margin-bottom: 12px;
  border: 1px solid rgba(243, 240, 231, 0.2);
  border-radius: 8px;
  padding: 0 12px;
  color: inherit;
  background: rgba(243, 240, 231, 0.06);
}

.board__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.board__row {
  display: grid;
  grid-template-columns: 36px 32px minmax(0, 180px) 96px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  border-top: 1px solid rgba(243, 240, 231, 0.12);
  padding: 10px 4px;
  color: inherit;
  text-decoration: none;
}

.board__row:hover {
  background: rgba(243, 240, 231, 0.05);
}

.board__rank {
  color: #b9c8c2;
  font-size: 14px;
  text-align: right;
}

.board__avatar {
  border-radius: 50%;
  background: #18271c;
}

.board__name {
  overflow: hidden;
  font-size: 15px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board__name small,
.board__score small {
  display: block;
  color: #b9c8c2;
  font-size: 12px;
  font-weight: 400;
}

.board__score {
  font-size: 15px;
  font-weight: 500;
  text-align: right;
}

.board__beds {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 6px;
  background: rgba(243, 240, 231, 0.05);
}

.board__empty {
  color: #b9c8c2;
}

@media (max-width: 640px) {
  .board__row {
    grid-template-columns: 28px 32px minmax(0, 1fr) auto;
  }

  .board__beds {
    grid-column: 1 / -1;
  }
}
```

- [ ] **Step 3: Country page**

Create `app/country/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Board } from "@/components/leaderboard/Board";
import { boardScaleMax } from "@/lib/rankings/bed-scale";
import { findCountry } from "@/lib/rankings/countries";
import { formatUpdated, isStale } from "@/lib/rankings/format";
import { getCountrySnapshot } from "@/lib/rankings/store";
import "@/components/leaderboard/leaderboard.css";

export const dynamic = "force-dynamic";

interface CountryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CountryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const country = findCountry(slug);
  return { title: country ? `Top gardeners in ${country.name}` : "Country not found" };
}

export default async function CountryPage({ params }: CountryPageProps) {
  const { slug } = await params;
  const country = findCountry(slug);
  if (!country) notFound();

  const snapshot = await getCountrySnapshot(country.slug);
  const now = new Date();

  return (
    <main className="board-page">
      <div className="board-page__inner">
        <Link className="board-page__back" href="/">
          ← All countries
        </Link>
        <h1>{country.name}</h1>
        {snapshot ? (
          <>
            <p className="board-page__meta">
              {snapshot.users.length} gardeners · {formatUpdated(snapshot.generatedAt, now)}
            </p>
            {isStale(snapshot.generatedAt, now) ? (
              <p className="board-page__stale">
                Last {formatUpdated(snapshot.generatedAt, now)}.
              </p>
            ) : null}
            <Board slug={country.slug} users={snapshot.users} scaleMax={boardScaleMax(snapshot.users)} />
          </>
        ) : (
          <p className="board-page__empty">This board is being planted. Check back tomorrow.</p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Check it in the browser with local data**

Serve the dry-run output from Task 14 and point the dev server at it:

```bash
npx --yes serve@14.2.4 ./tmp/rankings -l 4010 --cors
```

In another terminal: `RANKINGS_BASE_URL=http://localhost:4010 npm run dev`

Open `http://localhost:3000/country/netherlands`. Expected: header, gardener count, rows with avatars, scores, and year beds; typing in the filter narrows the list; clicking a row goes to `/u/<login>?from=netherlands` (404 until Task 20). Open `/country/japan` → "This board is being planted…". Open `/country/atlantis` → 404. Check at 375 px width: beds drop under the name.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`

```bash
git add components/leaderboard/Board.tsx components/leaderboard/leaderboard.css "app/country/[slug]/page.tsx"
git commit -m "Add the country leaderboard page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Landing page — hero, country grid, legacy redirects

**Files:**
- Create: `components/leaderboard/CountryGrid.tsx`
- Modify: `components/leaderboard/leaderboard.css` (append)
- Rewrite: `components/GardenPortal.tsx` (hero + username form only)
- Modify: `components/garden-portal.css` (remove banded veil overrides)
- Modify: `app/page.tsx`

- [ ] **Step 1: Country grid**

Create `components/leaderboard/CountryGrid.tsx`:

```tsx
import Link from "next/link";
import { COUNTRIES } from "@/lib/rankings/countries";
import { formatCount, formatUpdated } from "@/lib/rankings/format";
import type { RankingsIndex } from "@/lib/rankings/snapshot";

export function CountryGrid({ index }: { index: RankingsIndex | null }) {
  const entries = new Map(index?.countries.map((entry) => [entry.slug, entry]));
  const now = new Date();
  return (
    <section className="country-grid" aria-labelledby="country-grid-title">
      <h2 id="country-grid-title">Explore gardens by country</h2>
      <ul>
        {COUNTRIES.map((country) => {
          const entry = entries.get(country.slug);
          return (
            <li key={country.slug}>
              <Link className="country-card" href={`/country/${country.slug}`}>
                <strong>{country.name}</strong>
                {entry?.leader ? (
                  <span className="country-card__leader">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${entry.leader.avatarUrl}&s=48`} alt="" width={24} height={24} loading="lazy" />
                    @{entry.leader.login} · {formatCount(entry.leader.score)}
                  </span>
                ) : (
                  <span className="country-card__leader">Being planted</span>
                )}
                <small>
                  {entry ? `${entry.userCount} gardeners · ${formatUpdated(entry.updatedAt, now)}` : "No board yet"}
                </small>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

Append to `components/leaderboard/leaderboard.css`:

```css
.country-grid {
  padding: 48px 16px 80px;
  color: #f3f0e7;
  background: #0d1511;
}

.country-grid h2 {
  max-width: 960px;
  margin: 0 auto 20px;
  font-family: var(--font-newsreader), serif;
  font-size: clamp(26px, 4vw, 36px);
  font-weight: 500;
}

.country-grid ul {
  display: grid;
  max-width: 960px;
  margin: 0 auto;
  padding: 0;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  list-style: none;
}

.country-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  border: 1px solid rgba(243, 240, 231, 0.14);
  border-radius: 12px;
  padding: 16px;
  color: inherit;
  text-decoration: none;
  background: rgba(243, 240, 231, 0.04);
}

.country-card:hover {
  border-color: rgba(243, 240, 231, 0.32);
}

.country-card strong {
  font-size: 17px;
  font-weight: 500;
}

.country-card__leader {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.country-card__leader img {
  border-radius: 50%;
}

.country-card small {
  color: #b9c8c2;
  font-size: 12px;
}
```

- [ ] **Step 2: Rewrite GardenPortal as hero-only**

Replace the whole of `components/GardenPortal.tsx` with:

```tsx
"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeGardenHandle } from "@/lib/garden-provider";

import "./garden-portal.css";

export default function GardenPortal() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  function openGarden(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const handle = normalizeGardenHandle(username, "github");
    if (!handle) {
      setError("Enter a valid GitHub username.");
      return;
    }
    setOpening(true);
    router.push(`/u/${handle}`);
  }

  return (
    <section className="garden-portal is-landing" aria-labelledby="garden-portal-title">
      <div className="garden-portal__hero">
        <div className="garden-portal__image" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/garden-hero-v5-lush.webp"
            alt=""
            width="1672"
            height="941"
            decoding="async"
            fetchPriority="high"
          />
        </div>
        <div className="garden-portal__veil" aria-hidden="true" />

        <header className="garden-portal__header">
          <div className="garden-portal__brand" aria-label="Contribution Garden home">
            <span className="garden-portal__brand-name">Contribution Garden</span>
            <span className="garden-portal__brand-note">A living code archive</span>
          </div>
          <a className="garden-portal__edition" href="#country-grid-title">
            Top gardeners by country ↓
          </a>
        </header>

        <div className="garden-portal__content">
          <p className="garden-portal__eyebrow">
            <span aria-hidden="true">01</span>
            Your work, made living
          </p>
          <h1 id="garden-portal-title">
            Every contribution leaves <em>something growing.</em>
          </h1>
          <p className="garden-portal__lede">
            See the most active developers in your country as living gardens, or step inside
            anyone&apos;s GitHub history—where streaks become paths and years of work grow into
            landmarks.
          </p>

          <form className="garden-portal__entry" onSubmit={openGarden}>
            <label htmlFor="garden-username">GitHub username</label>
            <div className="garden-portal__entry-row">
              <div className="garden-portal__username">
                <span aria-hidden="true">@</span>
                <input
                  id="garden-username"
                  value={username}
                  placeholder="octocat"
                  onChange={(event) => {
                    setUsername(event.target.value);
                    if (error) setError(null);
                  }}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={opening}
                />
              </div>
              <button type="submit" disabled={opening}>
                <span>{opening ? "Opening the garden" : "Enter the garden"}</span>
                <span aria-hidden="true">{opening ? "···" : "↗"}</span>
              </button>
            </div>
            {error ? (
              <p className="garden-portal__error" role="alert">
                {error}
              </p>
            ) : (
              <p className="garden-portal__hint">Public contribution history · No sign-in required</p>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Remove the banded veil**

In `components/garden-portal.css`, delete the second `.garden-portal__veil { background: ... }` rule (the one with hard stops `0 30%, 30% 43%, ...`, around line 568) and, inside the `@media (max-width: 720px)` block near the end, delete the `.garden-portal__veil { ... }` rule with stops `0 20%, 20% 48%, ...`. The smooth gradients earlier in the file (around lines 52 and 400) then apply. The hero keeps its existing `position: absolute; inset: 0` inside the 100svh `.garden-portal` box, so the country grid simply follows it in normal flow. Append:

```css
a.garden-portal__edition {
  color: inherit;
  text-decoration: none;
}
```

- [ ] **Step 4: Landing page with legacy redirect**

Replace `app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
import GardenPortal from "@/components/GardenPortal";
import { CountryGrid } from "@/components/leaderboard/CountryGrid";
import { normalizeGardenHandle } from "@/lib/garden-provider";
import { getRankingsIndex } from "@/lib/rankings/store";
import "@/components/leaderboard/leaderboard.css";

export const dynamic = "force-dynamic";

interface HomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  if (typeof params.user === "string") {
    const provider = params.provider === "gitlab" ? "gitlab" : "github";
    const handle = normalizeGardenHandle(params.user, provider);
    if (handle) redirect(provider === "gitlab" ? `/u/${handle}?provider=gitlab` : `/u/${handle}`);
  }

  const index = await getRankingsIndex();
  return (
    <main>
      <GardenPortal />
      <CountryGrid index={index} />
    </main>
  );
}
```

- [ ] **Step 5: Check it in the browser**

With the setup from Task 18 Step 4 still running, open `http://localhost:3000/`. Expected: hero with no hard-edged dark blocks (compare against the old screenshot: the left/top/bottom bands are gone); scrolling shows the country grid; Netherlands shows a leader, others say "Being planted". `http://localhost:3000/?user=octocat` redirects to `/u/octocat` (404 until Task 20). Check 375 px width.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`

```bash
git add components/leaderboard/CountryGrid.tsx components/leaderboard/leaderboard.css components/GardenPortal.tsx components/garden-portal.css app/page.tsx
git commit -m "Turn the landing page into the country directory

Replaces the banded hero veil with the smooth gradient and redirects
old ?user= links to /u/<login>.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: `/u/<login>` garden page and the load-race fix

`ContributionGarden` currently fetches the store's default username ("octocat") before it reads the URL, then fetches the real user. It now takes the user as props, and the fetch waits until the store has been seeded.

**Files:**
- Create: `components/GardenRoute.tsx`, `app/u/[login]/page.tsx`
- Modify: `components/ContributionGarden.tsx` (props ~line 178, bootstrap effect ~lines 240–268, popstate effect ~270–300, fetch effect ~302–365, `handleSearch` ~714–745)
- Modify: `app/globals.css` (append back-link style)

- [ ] **Step 1: Props and seeded bootstrap**

In `components/ContributionGarden.tsx`:

1. Change the props interface and signature:

```tsx
export interface ContributionGardenProps {
  initialLogin: string;
  initialProvider: GardenProvider;
  onReady?: () => void;
}

export default function ContributionGarden({
  initialLogin,
  initialProvider,
  onReady,
}: ContributionGardenProps) {
```

2. Replace `const hasInitialized = useRef(false);` with:

```tsx
  const [bootstrapped, setBootstrapped] = useState(false);
```

3. Replace the whole bootstrap `useEffect` (the one starting `if (hasInitialized.current) return;`) with:

```tsx
  useEffect(() => {
    if (bootstrapped) return;
    setProvider(initialProvider);
    setUsername(initialLogin);
    setSearchValue(initialLogin);
    const now = new Date();
    setSeason(seasonForMonth(now.getMonth()));
    const localTime = timeForHour(now.getHours());
    setTimeOfDay(localTime === "night" ? "day" : localTime);
    setQuality(detectGardenQuality());
    setBootstrapped(true);
  }, [bootstrapped, initialLogin, initialProvider, setProvider, setSeason, setTimeOfDay, setUsername]);
```

4. In the fetch effect (the one that creates `new AbortController()`), make the first line:

```tsx
    if (!bootstrapped) return;
```

and add `bootstrapped` to its dependency array.

- [ ] **Step 2: `/u/` URLs for search and Back**

Add this helper above the component:

```tsx
function gardenPath(login: string, provider: GardenProvider): string {
  return provider === "gitlab" ? `/u/${login}?provider=gitlab` : `/u/${login}`;
}

function gardenFromLocation(): { login: string; provider: GardenProvider } | null {
  const match = /^\/u\/([^/]+)\/?$/.exec(window.location.pathname);
  if (!match) return null;
  const provider: GardenProvider =
    new URLSearchParams(window.location.search).get("provider") === "gitlab" ? "gitlab" : "github";
  const login = normalizeGardenHandle(decodeURIComponent(match[1]), provider);
  return login ? { login, provider } : null;
}
```

In the popstate handler, replace the body's parsing (the `params`/`requestedProvider`/`requested` lines and `if (!requested) return;`) with:

```tsx
      const target = gardenFromLocation();
      if (!target) return;
      const requested = target.login;
      const requestedProvider = target.provider;
```

leaving the rest of the handler unchanged.

In `handleSearch`, replace the four `nextUrl` lines with:

```tsx
      window.history.pushState({}, "", gardenPath(normalized, provider));
```

- [ ] **Step 3: Client route wrapper**

Create `components/GardenRoute.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { GardenProvider } from "@/lib/garden-provider";

const ContributionGarden = dynamic(() => import("@/components/ContributionGarden"), {
  ssr: false,
  loading: () => <div className="garden-route-loading" aria-hidden="true" />,
});

export interface GardenRouteProps {
  login: string;
  provider: GardenProvider;
  backHref: string;
  backLabel: string;
}

export default function GardenRoute({ login, provider, backHref, backLabel }: GardenRouteProps) {
  return (
    <>
      <ContributionGarden initialLogin={login} initialProvider={provider} />
      <Link className="garden-back-link" href={backHref}>
        <span aria-hidden="true">←</span> {backLabel}
      </Link>
    </>
  );
}
```

Append to `app/globals.css`:

```css
.garden-route-loading {
  width: 100%;
  height: 100svh;
  background: #56665f;
}

.garden-back-link {
  position: fixed;
  z-index: 60;
  bottom: 23px;
  left: 21px;
  display: flex;
  height: 34px;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(243, 240, 231, 0.2);
  border-radius: 18px;
  padding: 0 13px;
  color: rgba(243, 240, 231, 0.85);
  background: rgba(13, 21, 17, 0.78);
  font-family: var(--font-geist-mono), monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-decoration: none;
  text-transform: uppercase;
}

.garden-back-link:hover {
  color: #f3f0e7;
}
```

- [ ] **Step 4: The page**

Create `app/u/[login]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GardenRoute from "@/components/GardenRoute";
import { normalizeGardenHandle, type GardenProvider } from "@/lib/garden-provider";
import { findCountry } from "@/lib/rankings/countries";

interface UserPageProps {
  params: Promise<{ login: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function resolve({ params, searchParams }: UserPageProps) {
  const [{ login }, query] = await Promise.all([params, searchParams]);
  const provider: GardenProvider = query.provider === "gitlab" ? "gitlab" : "github";
  const handle = normalizeGardenHandle(decodeURIComponent(login), provider);
  const from = typeof query.from === "string" ? findCountry(query.from) : undefined;
  return { handle, provider, from };
}

export async function generateMetadata(props: UserPageProps): Promise<Metadata> {
  const { handle } = await resolve(props);
  return { title: handle ? `@${handle}'s garden` : "Garden not found" };
}

export default async function UserGardenPage(props: UserPageProps) {
  const { handle, provider, from } = await resolve(props);
  if (!handle) notFound();
  return (
    <GardenRoute
      login={handle}
      provider={provider}
      backHref={from ? `/country/${from.slug}` : "/"}
      backLabel={from ? from.name : "Home"}
    />
  );
}
```

- [ ] **Step 5: Verify the race is gone**

Run `npm run dev` (fresh server, so nothing is cached). Open `http://localhost:3000/u/sindresorhus`. In the dev-server output, run:

```bash
grep -c "api/github/octocat" <(tail -n 200 .wrangler/wrangler.log 2>/dev/null) || true
```

If the log isn't written there, read the dev server's terminal instead. Expected: exactly one `GET /api/github/sindresorhus` and **no** `GET /api/github/octocat`. The garden opens without an "Enter the garden" click, the back link reads "← Home", and the stats show a Lifetime card. Then open `http://localhost:3000/u/sindresorhus?from=germany` → back link reads "← Germany" and goes to `/country/germany`. Use the in-garden search to open `torvalds` → URL becomes `/u/torvalds`; browser Back returns to `/u/sindresorhus` and reloads that garden.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`

```bash
git add components/ContributionGarden.tsx components/GardenRoute.tsx "app/u/[login]/page.tsx" app/globals.css
git commit -m "Open gardens at /u/<login> and fix the double load

The garden fetched the store's default user before reading the URL.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Render tests for the new pages

**Files:**
- Modify: `tests/rendered-html.test.mjs`

- [ ] **Step 1: Update the landing test and add new ones**

In the existing `"server-renders the Contribution Garden shell"` test, keep every assertion (the hero, `Enter the garden`, and image assertions still hold) and add:

```js
  assert.match(html, /Explore gardens by country/);
  assert.match(html, /href="\/country\/germany"/);
```

Append these tests at the end of the file:

```js
const fixtureMonths = Array.from({ length: 12 }, (_, i) => i + 1);
const fixtureSnapshot = (slug, name) => ({
  version: 1,
  country: { slug, name },
  generatedAt: new Date().toISOString(),
  candidateCount: 2,
  users: [
    { rank: 1, id: 1, login: "first-gardener", name: "First Gardener", avatarUrl: "https://avatars.test/1?v=4", score: 78, years: [{ year: 2025, months: fixtureMonths }] },
    { rank: 2, id: 2, login: "second-gardener", name: null, avatarUrl: "https://avatars.test/2?v=4", score: 12, years: [{ year: 2026, months: fixtureMonths.map(() => 1) }] },
  ],
});

function stubRankings(baseUrl, files) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith(baseUrl)) {
      const body = files[url.slice(baseUrl.length + 1)];
      return body ? Response.json(body) : new Response("missing", { status: 404 });
    }
    return originalFetch(input, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("renders a country board from its snapshot", async () => {
  const baseUrl = "https://rankings-board.test";
  const restoreEnvironment = setTestEnvironment({ RANKINGS_BASE_URL: baseUrl });
  const restoreFetch = stubRankings(baseUrl, {
    "rankings/germany.json": fixtureSnapshot("germany", "Germany"),
  });
  try {
    const app = await worker();
    const response = await app.fetch(
      new Request("http://localhost/country/germany", { headers: { accept: "text/html" } }),
      environment,
      context,
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Germany/);
    assert.match(html, /First Gardener/);
    assert.match(html, /@second-gardener/);
    assert.match(html, /href="\/u\/first-gardener\?from=germany"/);
    assert.match(html, /<title>2025 · 78 contributions<\/title>/);
  } finally {
    restoreFetch();
    restoreEnvironment();
  }
});

test("shows a planting message when a country has no snapshot", async () => {
  const baseUrl = "https://rankings-empty.test";
  const restoreEnvironment = setTestEnvironment({ RANKINGS_BASE_URL: baseUrl });
  const restoreFetch = stubRankings(baseUrl, {});
  try {
    const app = await worker();
    const response = await app.fetch(
      new Request("http://localhost/country/japan", { headers: { accept: "text/html" } }),
      environment,
      context,
    );
    assert.equal(response.status, 200);
    assert.match(await response.text(), /This board is being planted/);
  } finally {
    restoreFetch();
    restoreEnvironment();
  }
});

test("returns 404 for an unknown country", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/country/atlantis", { headers: { accept: "text/html" } }),
    environment,
    context,
  );
  assert.equal(response.status, 404);
});

test("redirects legacy ?user= links to /u/<login>", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/?user=Octocat&provider=github", { redirect: "manual" }),
    environment,
    context,
  );
  assert.ok([302, 303, 307, 308].includes(response.status), String(response.status));
  assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, "/u/octocat");
});

test("serves a user garden page", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/u/octocat?from=germany", { headers: { accept: "text/html" } }),
    environment,
    context,
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /href="\/country\/germany"/);
  assert.match(html, /@octocat&#x27;s garden|@octocat's garden/);
});
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: all tests pass. If the redirect test gets a 200 with a meta refresh instead of a 3xx, check how vinext implements `redirect()` in `node_modules/vinext/dist/shims/navigation*` and assert on what it actually returns — do not weaken the other tests.

- [ ] **Step 3: Commit**

```bash
git add tests/rendered-html.test.mjs
git commit -m "Test the leaderboard, landing, and garden routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Final verification

- [ ] **Step 1: Everything green**

Run: `npm run typecheck && npm run lint && npm run test:unit && npm test`
Expected: all clean. Paste the pass/fail counts into the final report.

- [ ] **Step 2: Vercel build still works**

Run: `VERCEL=1 NITRO_PRESET=vercel npx vite build`
Expected: build completes without errors. (Do not deploy.)

- [ ] **Step 3: End-to-end in the browser**

With `npx --yes serve@14.2.4 ./tmp/rankings -l 4010 --cors` and `RANKINGS_BASE_URL=http://localhost:4010 npm run dev`:

1. `/` — smooth hero, country grid, Netherlands card shows its leader.
2. Click Netherlands → board with year beds; heavy and light users look clearly different.
3. Filter → narrows; nonsense filter → "No gardeners match".
4. Click a row → 3D garden opens directly, back link says "← Netherlands", Lifetime card matches the board score (± today's contributions).
5. Back link → board.
6. Phone width (375 px) for `/`, `/country/netherlands`, `/u/<login>`.

- [ ] **Step 4: Report**

Summarise for the user: what shipped, test counts, measured load time for a heavy user (Task 3), and the one-time setup they must do (Blob store; secrets `RANKINGS_GITHUB_TOKEN`, `BLOB_READ_WRITE_TOKEN`; variable and Vercel env `RANKINGS_BASE_URL`; then run the "Build rankings" workflow manually once). Note that the first full build of all 10 countries may need two daily runs because of GitHub's hourly rate limit; countries publish as they finish.
