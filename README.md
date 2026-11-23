# Contribution Garden

Contribution Garden turns a developer’s GitHub or GitLab history into a living,
explorable ecosystem. Commits grow vegetation, pull requests become trees,
issues bloom as flowers, streaks attract wildlife, and long-term milestones
permanently reshape the landscape.

## Local setup

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The project works immediately with a deterministic multi-year demo garden. No
GitHub credentials are needed for the demo.

### Live public GitHub data

Visitors do not create tokens or connect an account. Contribution Garden uses
one private OAuth App credential on the server for every public username.

1. Open [GitHub OAuth App settings](https://github.com/settings/applications/new)
   and create an OAuth App. For local development, use:

   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000`

   The garden does not send visitors through the callback; GitHub requires the
   field when the OAuth App is created.
2. Copy `.env.example` to `.env.local` and add the OAuth App's client ID and
   generated client secret:

   ```dotenv
   GITHUB_OAUTH_CLIENT_ID=...
   GITHUB_OAUTH_CLIENT_SECRET=...
   ```

3. Restart `npm run dev`.

Both values are read only by the GitHub API route. They are never added to the
browser bundle, a garden URL, or browser storage. Public live responses are
cached for 30 minutes on the local server, advertised to shared caches for the
same period, and can serve a recent cached copy during a temporary GitHub
outage.

`GITHUB_TOKEN` remains available only as a legacy server-side fallback. If no
server credential is configured, the app clearly labels and returns its
deterministic local demo. If a configured live credential is rejected or rate
limited, the API returns an explicit error instead of silently substituting
made-up contribution totals.

For private contribution details, a separate optional GitHub authorization
flow would still be required. The default garden intentionally reads only data
GitHub exposes publicly.

### Live public GitLab data

Choose GitLab on the entry screen and enter a GitLab username. GitLab.com works
without credentials: the server reads the public profile, public projects,
project language breakdowns, and the public contribution calendar. Set
`GITLAB_BASE_URL` for a GitLab Self-Managed host, or optionally provide a
server-side `GITLAB_TOKEN` for higher API limits.

GitLab’s public calendar currently covers the most recent 12 months and exposes
one aggregate activity count per day. The garden preserves that information and
labels commit, merge-request, and issue category totals as unavailable instead
of estimating them.

## Country leaderboards

Every day a GitHub Action ranks the most active GitHub users in each configured
country by lifetime public contributions (top 256 per country). The landing page
is a country directory; each country board draws every person as "year beds",
one raised bed per year. Clicking a person opens their 3D garden at
`/u/<login>`.

### One-time setup

1. Create a [Vercel Blob](https://vercel.com/docs/vercel-blob) store and make it
   public.
2. Add these repository secrets:
   - `RANKINGS_GITHUB_TOKEN`: a GitHub personal access token with no scopes. The
     built-in Actions token is limited to 1,000 requests an hour.
   - `BLOB_READ_WRITE_TOKEN`: the Blob store's read/write token.
3. Add the repository variable `RANKINGS_BASE_URL`, the Blob store's public base
   URL (for example `https://<store-id>.public.blob.vercel-storage.com`).
4. Add `RANKINGS_BASE_URL` to the Vercel project's environment variables too.
   Without it every board shows as "being planted".
5. Run the "Build rankings" workflow manually once.

The first full build of all countries may take two daily runs because of
GitHub's hourly rate limit. The job stops starting new countries after 290
minutes. Countries are published as they finish, and the stalest are rebuilt
first.

### Running locally

Dry run without uploading anything:

```bash
RANKINGS_GITHUB_TOKEN=... npm run rankings:build -- --country netherlands --limit 20 --out ./tmp/rankings
```

`--limit` is only allowed together with `--out`, so a partial board is never
published. To view the output, serve it and point the dev server at it:

```bash
python3 -m http.server 4010 --directory tmp/rankings
```

The local dev server runs inside Cloudflare's workerd runtime, which only sees
variables from `.env.local`. Either put `RANKINGS_BASE_URL=http://localhost:4010`
in `.env.local`, or start dev with:

```bash
CLOUDFLARE_INCLUDE_PROCESS_ENV=true RANKINGS_BASE_URL=http://localhost:4010 npm run dev
```

### Adding a country

Edit `lib/rankings/countries.ts`. `names` are country-level terms; they are also
used to exclude people whose location names another configured country. `cities`
are only searched.

## Experience

### Reading a garden

Each garden is drawn from the person's real history, so a light contributor
and a heavy one look clearly different:

| In the garden | Comes from |
| --- | --- |
| Island size | How many years of history there are |
| A tree for each year | That year's contributions; bigger trees mean busier years |
| The great tree | Lifetime contributions; it glows after a 365-day streak |
| Meadow beds along the year rings | Every day with contributions; denser and brighter means more |
| Wildflowers | Pull requests and issues in the past 12 months |
| Butterflies and birds | Recent activity |
| Fireflies | A longest streak of 30 days or more |
| Pond size | Public repositories |

A "Reading the garden" legend in the stats panel explains this on screen.
Clicking any tree, flower, meadow bed or the pond shows its details.

### Features

- A lush, sunlit floating island with a pond that spills into a waterfall, the
  same look on every device (quality tiers only change density, shadows and
  post-processing)
- GitHub and GitLab username search, with shareable garden URLs at
  `/u/<login>` (GitLab: `/gitlab?user=<handle>`)
- Country leaderboards on the landing page, with every ranked person drawn as
  year beds
- Multi-year growth timeline with playback; trees appear in place as their
  year arrives
- Spring, summer, autumn, and winter ecosystems
- Sun, rain, wind, fog, and snow weather systems
- Morning, daylight, and sunset lighting
- Cinematic fly-through, walk-through mode, ambient sound, and local
  screenshot export
- Responsive desktop and mobile layouts with reduced-motion support

## Commands

```bash
npm run dev        # start the local experience
npm run build      # create a production build locally
npm run lint       # run code-quality checks
npm run typecheck  # run the TypeScript compiler in check-only mode
npm test           # build and run route/render smoke tests
```

## Production deployment

The app targets Cloudflare Workers via `vinext` (`worker/index.ts` is the
entry point). Before deploying:

1. Set the environment secrets from `.env.example` — at minimum
   `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` for live public
   data. Set `NEXT_PUBLIC_SITE_URL` to the production origin so canonical and
   Open Graph metadata resolve correctly.
2. Optionally configure `GARDEN_API_RATE_LIMIT` (requests per minute per IP
   for the garden API; default 60) and `LOG_LEVEL` (default `info`).
3. Deploy with your Cloudflare tooling of choice (`wrangler deploy` or CI).
   The worker applies baseline security headers to every response,
   normalizes unhandled exceptions into JSON/HTML 500s, and logs structured
   request outcomes.

Operational endpoints:

- `GET /api/health` — liveness probe returning `{ ok: true }` plus which data
  sources are configured (never secret values).
- `GET /api/github/:username` and `GET /api/gitlab/:username` — rate limited per
  client IP, negatively cached
  for 30 seconds after upstream failures (with stale-while-error serving), and
  cached fresh for 30 minutes per credential scope.
- GitHub session refreshes are single-flighted so concurrent requests cannot
  race a rotating refresh token.

## Data behavior

Both provider routes return the same normalized garden data model. With the
server OAuth App credential—or the legacy backend `GITHUB_TOKEN`—the GitHub
route loads
public contribution calendars, commits, pull requests, issues, reviews,
repositories, stars, followers, languages, and contribution years via GraphQL.
Without a credential, it returns a clearly labelled username-seeded demo so
every garden mechanic remains explorable.
