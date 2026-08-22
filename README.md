# Contribution Garden

Contribution Garden turns a developer’s GitHub history into a living, explorable
ecosystem. Commits grow vegetation, pull requests become trees, issues bloom as
flowers, streaks attract wildlife, and long-term milestones permanently reshape
the landscape.

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

## Experience

- Procedural 3D terrain, pond, paths, vegetation, trees, flowers, and wildlife
- GitHub username search with shareable local URLs
- Multi-year growth timeline with playback controls
- Spring, summer, autumn, and winter ecosystems
- Sun, rain, wind, fog, and snow weather systems
- Morning, daylight, sunset, and night lighting
- Clickable contribution, pull-request, issue, water, and achievement specimens
- Activity-driven water health and vegetation density
- Natural-event achievements for streaks and contribution milestones
- Cinematic fly-through, ambient sound, and local screenshot export
- Responsive desktop and mobile controls with reduced-motion support

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
- `GET /api/github/:username` — rate limited per client IP, negatively cached
  for 30 seconds after upstream failures (with stale-while-error serving), and
  cached fresh for 30 minutes per credential scope.
- GitHub session refreshes are single-flighted so concurrent requests cannot
  race a rotating refresh token.

## Data behavior

`GET /api/github/:username` returns a normalized garden data model. With the
server OAuth App credential—or the legacy backend `GITHUB_TOKEN`—it loads
public contribution calendars, commits, pull requests, issues, reviews,
repositories, stars, followers, languages, and contribution years via GraphQL.
Without a credential, it returns a clearly labelled username-seeded demo so
every garden mechanic remains explorable.
