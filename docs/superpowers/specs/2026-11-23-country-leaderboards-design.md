# Country leaderboards with year-bed gardens — design

Date: 2026-11-23
Status: approved in brainstorming, awaiting spec review

## Goal

Turn Contribution Garden from a single-user 3D viewer into a "top committers"
style site: pick a country, see its most active GitHub users ranked by
lifetime contributions, and see each person's history as a small garden
instead of only a number. Clicking a person opens their existing 3D garden.

## Decisions

| Topic | Decision |
| --- | --- |
| Who is ranked | Per country, discovered through GitHub user search by location |
| Ranking score | Lifetime total contributions: the sum of each year's `contributionCalendar.totalContributions` (includes private contributions only where the user has chosen to show them on their profile) |
| List visual | "Year beds": one raised bed per year, 12 stems per bed for monthly counts |
| Detail view | The existing 3D garden at `/u/<login>` (its restyle is a separate spec) |
| Hosting | Vercel |
| Data refresh | Daily GitHub Action builds one JSON snapshot per country and uploads it to Vercel Blob |

## Scope

In scope:

1. Rankings pipeline (GitHub Action, scripts, snapshot format, Blob upload).
2. Leaderboard UI: landing country grid, country board, routing to the 3D garden.

Out of scope (each gets its own spec):

- Restyling the 3D garden and fixing how it scales with activity.
- Weak data-to-visual mapping in the 3D scene (part of the restyle spec).

Prerequisites done at the start of this work (Part A of the plan): the
shared-link double load, the ~39 s load for heavy users, and a lifetime total
on the garden page. The "last 12 months" totals turned out to be intentional
(labelled "Last year" and covered by a test) and stay as they are.
- Rank-change history ("up 3 since yesterday").
- GitLab leaderboards.

## 1. Rankings pipeline

### Country config — `lib/rankings/countries.ts`

```ts
interface CountryConfig {
  slug: string;        // "germany"
  name: string;        // "Germany"
  aliases: string[];   // ["Germany", "Deutschland", "Berlin", "Munich", "Hamburg", ...]
}
```

Launch list (10): United States, India, Germany, United Kingdom, France,
Brazil, Canada, Netherlands, Japan, Poland. Adding a country is a config edit.

### Discovery

For each alias, call GitHub REST user search:
`q=location:"<alias>" followers:>10 type:user`, `sort=followers`,
`order=desc`, paged up to the API cap of 1,000 results. Search results carry
no follower counts, so the per-alias lists (each already sorted by followers)
are merged round-robin, de-duplicated by user id, and cut at 1,000 candidates.
Search is limited to 30 requests/minute, so search calls are throttled to one
every 2.1 s (about 10 pages per alias).

### Lifetime score and monthly history

Per candidate, reuse the per-year history query from
`app/api/github/[username]/route.ts`, but request only
`contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }`
per year (no `commitContributionsByRepository`, which is what made heavy
users take ~39 s). The first query returns the profile, `contributionYears`,
the rate limit, and the two most recent years; a new user's earlier years
(from their first contribution year) follow in batches of 8 years per query.
Users are processed 4 at a time.

- `score` = sum of all daily counts, which equals the sum over years of
  `totalContributions`.
- `months` = daily counts rolled up into 12 monthly totals per year.

### Incremental refresh

Each run downloads the previous `rankings/<slug>.candidates.json` (all
candidates, not just the public top 256). For a user already
present, stored past years are reused and only the current year is fetched
(plus the previous year during January, to pick up late-arriving data). New
candidates get a full fetch. After the first full build, a daily refresh costs
roughly one GraphQL query per candidate.

The job reads GitHub's `rateLimit { remaining resetAt }` and sleeps until
reset when `remaining` drops below 200.

### Snapshot format — `lib/rankings/snapshot.ts`

`rankings/<slug>.json`:

```ts
interface CountrySnapshot {
  version: 1;
  country: { slug: string; name: string };
  generatedAt: string;           // ISO timestamp
  candidateCount: number;        // people evaluated
  users: RankedUser[];           // top 256 by score, sorted desc
}

interface RankedUser {
  rank: number;                  // 1-based competition ranking: 1, 2, 2, 4
  id: number;                    // GitHub user id (stable across renames)
  login: string;
  name: string | null;
  avatarUrl: string;
  score: number;                 // lifetime total contributions
  years: { year: number; months: number[] /* length 12 */ }[]; // oldest first
}
```

`rankings/index.json`:

```ts
interface RankingsIndex {
  version: 1;
  generatedAt: string;
  countries: {
    slug: string;
    name: string;
    updatedAt: string;
    userCount: number;
    leader: { login: string; avatarUrl: string; score: number } | null;
  }[];
}
```

The same module exports a runtime validator and the pure helpers:
`rollUpMonths(days)`, `scoreFromYears(years)`, `mergeWithPrevious(prev, fresh, currentYear)`,
`rankUsers(users, limit)`.

All candidates (up to 1,000, same `RankedUser` shape) are stored in
`rankings/<slug>.candidates.json` for incremental reuse; only the top 256 go
into `<slug>.json`, which is the only file the site reads.

### Shared GitHub client — `lib/github/graphql.ts`

Extract the GraphQL fetch, error types, and rate-limit handling from
`app/api/github/[username]/route.ts` so the API route and the build script
share one implementation. The route's behaviour must not change.

### Build script — `scripts/build-rankings.ts`

```
npx tsx scripts/build-rankings.ts [--country <slug>] [--limit <n>] [--out <dir>]
```

`tsx` is added as a dev dependency; it runs TypeScript and resolves the `@/`
path alias from `tsconfig.json`. Uploads use the `@vercel/blob` package.

- No flags: all countries, upload to Blob.
- `--country`: one country only.
- `--limit`: cap candidates (for dry runs).
- `--out`: write JSON to a local directory instead of uploading.

Countries are processed one after another, never-built and least recently
updated first, so a first full build that cannot finish in one run (GitHub's
hourly rate limit) completes over the following runs. A failure in one country
logs the error, leaves that country's previous Blob file in place, and
continues; the process exits non-zero at the end if any country failed. A
single user that errors (deleted, renamed, suspended) is skipped; an auth or
rate-limit error fails the country. `index.json` is rewritten after every
finished country, so a run cut off by the timeout still publishes its work.

### Workflow — `.github/workflows/rankings.yml`

- Schedule: daily at 03:00 UTC, plus `workflow_dispatch` with an optional
  `country` input.
- Secrets: `RANKINGS_GITHUB_TOKEN` (a personal access token with no scopes;
  the built-in `GITHUB_TOKEN` is limited to 1,000 requests/hour) and
  `BLOB_READ_WRITE_TOKEN`; repository variable `RANKINGS_BASE_URL` (the Blob
  store's public base URL), which the Vercel project also needs as an env var.
- `timeout-minutes: 350`.

## 2. Leaderboard UI

### Routes

| Route | Content |
| --- | --- |
| `/` | Existing hero (with the banded veil replaced by a smooth gradient), then a country grid and a username lookup box |
| `/country/<slug>` | Ranked board for one country |
| `/u/<login>` | The existing 3D garden, opened directly (no "Enter the garden" click), with a back link to the referring board |

The current `?user=` / `?provider=` URLs redirect to `/u/<login>` (GitHub) so
shared links keep working. GitLab gardens stay reachable at
`/u/<login>?provider=gitlab`.

### Snapshot reading — `lib/rankings/store.ts`

Server-side fetch of `rankings/index.json` and `rankings/<slug>.json` from
`RANKINGS_BASE_URL`, cached in memory for 10 minutes per URL (not relying on
Next's fetch cache, whose support in vinext is unverified). Responses are
validated; an invalid, missing, or unreachable file is treated as "no
snapshot". Blob files are uploaded with a 5-minute CDN max-age.

The garden page also gains a "Lifetime" stat card computed from its calendar,
so the number on `/u/<login>` matches the board. The existing "Last year"
cards are unchanged.

### Country grid — `components/leaderboard/CountryGrid.tsx`

One card per country from `index.json`: country name, leader avatar and login,
leader's score, user count, and "updated N hours ago".

### Board — `components/leaderboard/Board.tsx`

- Header: "All countries" back link, country name, "<n> gardeners · updated
  <relative time>".
- Client-side filter input matching login or name.
- One row per user: rank, avatar, name and `@login`, lifetime score (with
  thousands separators), year beds. The whole row links to `/u/<login>`.
- All 256 rows render at once; the year beds are lightweight SVG.
- Narrow screens (< 640 px): the year beds move to a full-width line under the
  name and score.

### Year beds — `components/leaderboard/YearBeds.tsx`

Pure function component: `({ years, scaleMax }) => <svg>`.

- One bed per year, oldest on the left; beds share the available width with a
  4 px gap and a maximum bed width of 36 px.
- 12 stems per bed. Stem height = `log1p(monthCount) / log1p(scaleMax)` of the
  bed's maximum height, where `scaleMax` is the largest single monthly count on
  the whole board. A shared scale is what makes heavy and light contributors
  look different.
- Stem colour steps through four greens by the same normalised value.
- A flower sits on the top of each bed's busiest month when that month's value
  is above 0.5 on the normalised scale.
- Each bed has a `<title>`: "2019 · 4,210 contributions".
- The SVG has `role="img"` and an `aria-label` summarising the span and total.

### Empty and error states

| Situation | Shown |
| --- | --- |
| Country has no snapshot yet | "This board is being planted. Check back tomorrow." |
| Snapshot older than 48 hours | Note under the header: "Last updated N days ago" |
| Unknown slug | 404 page |
| Board user since deleted/renamed | Row stays until the next run; `/u/<login>` shows the existing "user not found" state |
| Filter matches nobody | "No gardeners match '<text>'." |

## 3. Testing

- Unit tests (`node --test`) with fixtures for: `rollUpMonths` (month
  boundaries, leap years), `scoreFromYears`, `mergeWithPrevious` (reuses past
  years, refetches the current year, handles a user with no previous entry),
  alias de-duplication, `rankUsers` tie handling, the snapshot validator, and
  the year-bed height function (shared scale, zero months, `scaleMax` of 0).
- Dry run: `npx tsx scripts/build-rankings.ts --country netherlands --limit 20 --out ./tmp/rankings`
  and check the files against the validator.
- Render tests following `tests/rendered-html.test.mjs`: `/` with a fixture
  index shows the country grid; `/country/<slug>` with a fixture snapshot shows
  ranked rows and year-bed SVGs; an unknown slug returns 404.
