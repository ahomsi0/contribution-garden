# 3D garden restyle — design

Date: 2026-11-23
Status: decided autonomously. The user asked for the whole redesign to be done without stopping, so every decision is recorded here.
Branch: `garden-restyle`, stacked on `country-leaderboards`.

## Problem

The 3D garden at `/u/<login>` reads the same for 40 contributions as for 200,000, and it looks muddy. A scene survey on 2026-11-23 found these causes:

1. On medium and high quality (all desktops), the data-driven pieces never render. Pull-request trees, issue flowers, the streak glow, wildlife and clouds exist only on `low`. Desktops get 7 decorative trees, 24 shrubs and 14 rocks from `LightweightNature`.
2. Foliage and grass use `MeshBasicMaterial`, so they are unlit and flat. The palettes are deliberately desaturated, and ACES tone mapping desaturates them further. There is no post-processing.
3. Medium quality swaps in a separate voxel island, which is a different art style.
4. Island size is fixed. Per-day intensity uses GitHub's per-user quartiles, so everyone's busiest days look identical. The hero tree varies by about 0.19 in scale.
5. Desktop users can't see any stats. `ProfileMetricsPanel` only renders in the mobile sheet.

## Goal

The garden should look like the landing image: a lush, sunlit floating island with saturated greens, a big tree, a pond spilling into a waterfall, a stone path and wildflowers. And it should be readable: a glance tells a light user from a heavy one, and a legend explains what each thing means.

## Decisions

### One scene for every quality tier
Every tier renders the same elements in the same style. A tier only changes:

| | low | medium | high |
|---|---|---|---|
| density multiplier | 0.5 | 0.8 | 1.0 |
| shadows | off | 1024 PCF, redrawn every 4th frame | 2048 PCF soft, redrawn every 4th frame |
| dpr | 1 | ≤1.25 | ≤1.5 |
| post-processing | none | FXAA and vignette | FXAA, bloom and vignette |
| waterfall mist particles | off | on | on |

The voxel island, `LightweightNature`, the dead `PhotorealNature.tsx`, and every `quality === "low"`-only branch are removed.

### Data → visual mapping
This lives in a pure, unit-tested module: `components/garden/world/mapping.ts`. All inputs are already available to the scene:
- `days` (the full calendar)
- `visibleThrough`
- `stats` (`pullRequests` and `issues` are last-12-months; `repositories`; `streak`)
- `activity` (0..1)
- `seed`
- density

Year totals use only the days visible on the timeline, so playback grows the garden.

| Element | Meaning | Formula |
|---|---|---|
| Island radius | Years of history | `clamp(9 + 0.28 × spanYears, 9, 13)`. `spanYears` runs from the first year with any contribution to the last visible year. |
| **Year trees** | One tree per calendar year with contributions | Canopy scale is `clamp(0.55 + 0.32·log10(1 + yearTotal), 0.6, 1.9)`: 1 contribution gives 0.65, 100 gives 1.19, 1k gives 1.51, and 10k or more gives 1.83. Trees sit in chronological order around a ring of radius `max(7.4, 0.76 × islandRadius)`, starting just after the path. Each active year in the **full** history owns a fixed angular slot (`2π / max(activeYears, 6)` apart), with jitter seeded by the garden seed and the year, so a tree keeps its angle while the timeline plays; only its distance follows the growing ring. Years with 0 contributions get no tree. |
| **Great tree** | Lifetime total | Scale is `clamp(0.9 + 0.22·log10(1 + lifetime), 0.9, 2.1)`: 40 gives about 1.25, and 83k gives about 1.98. It stays at the current hero spot (2.62, 0.48). |
| Meadow (day plots) | Each day with contributions | Keep the existing year-ring layout. Blades per day are `clamp(1 + floor(log2(count)), 1, 6) × density`, minimum 1. Intensity level uses **absolute** thresholds: 1–2 gives 1, 3–5 gives 2, 6–9 gives 3, 10 or more gives 4. GitHub's per-user quartiles are no longer used. |
| Wildflowers | PRs + issues in the last 12 months | `round(clamp(6 + 10·log2(1 + prs + issues), 6, 110) × density × seasonFactor)`. `seasonFactor` is 1.2 in spring, 1 in summer, 0.6 in autumn and 0.15 in winter. They are scattered off the meadow rings and the path. |
| Butterflies | Recent activity | `round(activity × 6)`, with a minimum of 1 when activity > 0.2. Spring and summer only. |
| Birds | Recent activity | `activity > 0.3 ? 2 + round(activity × 4) : 0` |
| Fireflies | Longest streak | Shown when the streak is 30 days or more: `min(40, 8 + streak/10)`. Full brightness at sunset and night; at 0.35 opacity in the daytime, so a streak still reads. |
| Great tree glow | Streak ≥ 365 | A soft emissive canopy rim plus floating lights. This keeps today's "legendary" idea and makes it visible on every tier. |
| Pond size | Public repositories | Scale `clamp(0.85 + 0.12·log10(1 + repos), 0.85, 1.25)` |
| Decoration | — | 10–16 shrubs and 8–12 rocks, scaled by density, each count drawn from its own seeded stream so it never changes with the timeline. This is deliberately fewer than today, so the data reads first. |

`mapping.ts` exports `computeGardenLayout(input): GardenLayout`, which is deterministic for a given seed. The tests check that a 40-contribution history and an 83k-contribution history produce clearly different layouts: island radius, tree count and sizes, great-tree scale and flower count.

### Look
- **Tone mapping.** `THREE.NeutralToneMapping` at exposure 1.0. It keeps saturation where ACES did not.
- **Palette.** This lives in a pure module, `components/garden/world/palette.ts`: four seasons × four times of day, with explicit hex values. Summer reference values:
  - grass `#6fae3f`, varying to `#9ccc5a`
  - foliage `#3f8f3a #57a845 #7cc05a #a6d96a`
  - trunk `#6b4a32`
  - stone `#bdb5a4`
  - water `#3fa7b8`, with glow `#8fe0e6`
  - day sky gradient `#86c2ec` → `#a9d4f1` → `#cfe7f2`, horizon `#f3e3b8`, sun `#fff1c9`
  - cliff `#7b6a58`, earth `#5a4330`
  - flowers `#8b6fd6 #f2c94c #ffffff #e86f9c`
- **Autumn is vivid, not brown.** Deciduous canopies use `#d9822b #e8a33d #c0472d #f2c14e`. Every fourth year tree is an evergreen that stays `#3f7a45`. Grass is `#7fb444`, varying to `#a5cf5c`: still a touch golden, but green enough to read as grass at sunset.
- **Winter.** Snow ground `#eef3f5`. Evergreens are dusted, deciduous trees are bare branches with a few canopy tufts, and the winter day sky is a paler gradient, `#b4cfe8` → `#cadeee` → `#e0ebf2`.
- **Spring.** Brighter greens, with blossom tints `#f6b8cf` mixed into canopies.
- **Times of day.** Morning is warm-pink, day is bright and neutral. Sunset is a golden hour on a green garden: sky `#6f86c9` → `#c49ab8` → `#f0a872`, horizon `#ffd59a`, fog `#f2c9a8`, sun `#ffc58a` at intensity 2.1, and a cool hemisphere sky `#9fb7e8` at 0.8 so the grass keeps its green under the orange sun. Night stays as the existing code has it; the app never selects it.
- **Lighting.**
  - Hemisphere light: sky `#cfe8ff`, ground earth tone, intensity about 1.1.
  - Warm key directional light: intensity about 2.6, casting shadows on medium and high.
  - The ambient light is dropped.
  - Small fill from the horizon colour.
- **Materials.** Everything is lit, using `MeshStandardMaterial` with `vertexColors` and roughness 0.8–0.95.
  - Canopies are clusters of 3–6 smooth icosahedrons, detail 1–2, with per-vertex gradients (darker underside, sunlit top) and per-tree hue jitter.
  - Rocks are flat-shaded.
  - Grass blades are lit, with a base-to-tip gradient.
- **Terrain.** Keep the `photoreal-geometry.ts` island mesh (used on every tier) with a radius parameter. Its clamp changes from 11–13 to 9–13.
  - The grass top gets noise-varied greens.
  - There is a soil band, and a warm rock cliff with strata tint.
- **Water.** A lit, glossy pond, plus a **waterfall**: a narrow animated stream from the pond's outflow over the nearest rim edge and down the cliff, with mist particles at the lip on medium and high. This echoes the landing image.
- **Camera.** The orbit camera turns so the waterfall is framed on the right of the view, about 38° off the view axis, clear of the stats panel on the left. It frames the full-history garden, so it holds still while the timeline plays.
- **Path.** Lighter stepping stones along the existing path line.
- **Sky.** Restyle the gradient dome. Soft clouds (clusters of spheres, lit), 3 on low, 5 on medium, 7 on high, drifting slowly.
- **Post-processing** (`@react-three/postprocessing`, already a dependency):
  - Medium: `FXAA` plus `Vignette`.
  - High: `FXAA`, `Bloom` (intensity about 0.25, luminance threshold about 0.85) plus `Vignette`.
  - Anti-aliasing is FXAA, not MSAA: the canvas is created without multisampling and the composer uses none, because a multisampled half-float target cost 5–11 ms a frame.
  - Tone mapping runs exactly once, first in the composer. Don't double-tone-map.
- **Shadows** are redrawn every 4th frame rather than every frame, which keeps their cost low while trees and the island still grow smoothly.

### Scene structure
`components/garden/GardenScene.tsx` keeps:
- the Canvas shell and ready/capture signals;
- the camera rigs (orbit, flythrough, walkthrough);
- weather;
- the public `GardenSceneProps` and the `GardenSelection` contract.

`ContributionGarden.tsx` keeps working unchanged. The world content moves into focused files under `components/garden/world/`:

| File | Responsibility |
|---|---|
| `mapping.ts` | pure data → layout |
| `palette.ts` | pure colours per season and time of day |
| `Island.tsx` | terrain mesh and materials |
| `Water.tsx` | pond and waterfall |
| `Meadow.tsx` | day-plot grass (replaces `GrassMeadow`) |
| `Trees.tsx` | year trees and the great tree, instanced canopies, selection |
| `Flora.tsx` | wildflowers, shrubs, rocks, path stones |
| `Life.tsx` | butterflies, birds, fireflies |
| `Sky.tsx` | dome, clouds, lights |
| `Effects.tsx` | post-processing per tier |

Old content components are deleted from `GardenScene.tsx` once they are replaced. The walkthrough's walkable test uses `islandRadius − 0.7` rather than the fixed 10.78, and treats every year tree and the great tree as obstacles.

### Selection
- Year tree: `kind: "tree"`, `id: year-tree-YYYY`, title `YYYY`, subtitle "A year of contributions". Details: Contributions, Busiest month, Active days.
- Great tree: `kind` "achievement" if the streak is 365 or more, otherwise "tree". Title "Great tree". Details: Lifetime contributions, Longest streak, Years growing.
- Day plot and pond: unchanged.
- Flowers: `kind: "flower"`. Details: Pull requests (12 mo), Issues (12 mo).

### UI
- **Desktop stats.** In the `cinematic` presentation, `ProfileMetricsPanel` (compact) renders on desktop at the left. It is hidden while walking or in flythrough, using the existing CSS hooks.
- **"Reading the garden" legend.** A short list inside the profile panel:
  - Trees: one per year, sized by that year's contributions.
  - Great tree: lifetime total.
  - Meadow: each day you contributed, denser means more.
  - Wildflowers: pull requests and issues in the past year.
  - Butterflies and birds: recent activity.
  - Fireflies: a streak of 30 days or more.
  - Pond: public repositories.

  It is collapsible, and the open/closed state is remembered in `localStorage`. It appears on mobile too, in the Steward sheet.

### Out of scope
- New camera modes and a night mode.
- Sound.
- Changes to `/api/*`.
- The leaderboard pages.
- Deleting `public/photoreal/` (22 MB, now unreferenced) and the unused hero images. These are the user's assets; they are listed in the PR as follow-ups.

## Known follow-ups
- **Shadow sway.** Canopies sway in the vertex shader, but the shadow pass uses the default depth material, so shadows stay still while crowns move. A custom depth material with the same sway would fix it.
- **GitLab wildflower minimum.** GitLab has no pull-request or issue counts, so the legend says wildflowers are unavailable, yet the mapping still plants its minimum of six.
- **Duplicate PRNG helpers.** `mulberry32` and `seededRandom` are copied across `mapping.ts`, `tree-shapes.ts`, `meadow-layout.ts`, `Sky.tsx`, `Water.tsx` and `GardenScene.tsx`; they should share one module.

## Verification
- Unit tests for `mapping.ts` and `palette.ts`. Tests compare a light history against a heavy one, check determinism per seed, check timeline cut-offs, and validate hex values.
- `npm run typecheck`, `npm run lint`, `npm run test:unit` and `npm test` must pass. The Vercel build must succeed.
- Visual checks by the controller in the browser, using @octocat (light), @jeroen (heavy, 83k) and @timneutkens. Check:
  - all four seasons;
  - desktop and 375 px;
  - medium and high tiers;
  - the light and heavy users side by side, which must look clearly different;
  - no console errors.
- Performance on high: `renderer.info.render.calls` stays at or below 60, and the scene stays interactive. Check FPS through a `requestAnimationFrame` sample of about 5 s, aiming for 55 or more on the dev machine.
