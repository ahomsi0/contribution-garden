# 3D Garden Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the 3D garden lush, sunlit and readable, so that a light contributor and a heavy one look clearly different. Use one visual style on every quality tier, and show stats with a legend on desktop.

**Architecture:**
- Two pure, unit-tested modules, `components/garden/world/mapping.ts` and `palette.ts`, decide what to draw and in which colours.
- Focused R3F components under `components/garden/world/` draw it.
- `GardenScene.tsx` keeps the Canvas shell, the camera rigs, weather and the public props. Its `GardenWorld` composes the new components.
- Old tier-specific content components are deleted as they are replaced.

**Tech stack:**
- React Three Fiber 9, drei 10, three 0.185 (`NeutralToneMapping`), `@react-three/postprocessing` 3
- `node:test` with tsx

**Spec:** `docs/superpowers/specs/2026-11-23-garden-restyle-design.md`

**Note on plan style.** The pure modules below have exact interfaces and tests. The rendering tasks give exact files, props, data flow and acceptance criteria rather than full code. Visual quality is judged in the browser by the controller after each rendering task, and tuned in follow-up dispatches.

## Ground rules
- Repo: `/Users/ahomsi/Development/Personal Projects/Contribution Garden`. The path contains spaces, so quote it.
- Branch: `garden-restyle`.
- The controller owns the dev server on port 3000. Do not start or stop servers.
- Gates:
  - `npm run test:unit` (fast)
  - `npm test` (builds the worker, then runs render and API tests)
  - `npm run typecheck`
  - `npm run lint`
- `GardenSceneProps`, `GardenSelection` and the `GardenScene` export must stay compatible. `components/ContributionGarden.tsx` must not need changes, except in Task 10.
- Stage only your own files. Commit messages end with the session's attribution line.
- Never commit `.claude/` or `tmp/`.

---

### Task 1: `world/mapping.ts` (pure)

**Files**
- Create `components/garden/world/mapping.ts`.
- Test in `tests/unit/garden-mapping.test.ts`.

**Interface (exact):**

```ts
import type { GardenSeason } from "../types";

export interface MappingInput {
  days: ReadonlyArray<{ date: string; count: number }>;
  /** ISO date (YYYY-MM-DD). Days after it are ignored. Undefined means all. */
  visibleThrough?: string;
  stats: { pullRequests: number; issues: number; repositories: number; streak: number };
  /** 0..1 recent-activity health. */
  activity: number;
  season: GardenSeason;
  seed: number;
  /** Tier density multiplier: low 0.5, medium 0.8, high 1. */
  density: number;
}

export interface YearTreeLayout {
  year: number;
  total: number;
  activeDays: number;
  /** 0-11 */
  busiestMonth: number;
  scale: number;
  x: number;
  z: number;
  rotation: number;
  evergreen: boolean;
}

export interface GardenLayout {
  islandRadius: number;
  spanYears: number;
  lifetime: number;
  treeRingRadius: number;
  yearTrees: YearTreeLayout[];
  greatTree: { x: number; z: number; scale: number; glowing: boolean };
  pond: { x: number; z: number; scale: number };
  flowerCount: number;
  butterflyCount: number;
  birdCount: number;
  fireflyCount: number;
  shrubCount: number;
  rockCount: number;
}

export const GREAT_TREE_POSITION = { x: 2.62, z: 0.48 } as const;
export const POND_POSITION = { x: -2.35, z: 1.25 } as const;
/** The path is the line z = PATH_SLOPE * x + PATH_INTERCEPT. */
export const PATH_SLOPE = -0.24;
export const PATH_INTERCEPT = -2.3;

export function intensityLevel(count: number): 0 | 1 | 2 | 3 | 4;
export function bladesForDay(count: number, density: number): number;
export function distanceToPath(x: number, z: number): number;
export function computeGardenLayout(input: MappingInput): GardenLayout;
```

**Rules.** Implement these exactly.

- **Visible days.** `count > 0`, and `date <= visibleThrough` when `visibleThrough` is set.
- **`intensityLevel(c)`.** `c <= 0` gives 0; 1–2 gives 1; 3–5 gives 2; 6–9 gives 3; 10 or more gives 4.
- **`bladesForDay(c, d)`.** If `c <= 0` return 0. Otherwise `max(1, round(clamp(1 + floor(log2(c)), 1, 6) * d))`.
- **`lifetime`.** The sum of visible counts.
- **`spanYears`.** No visible activity gives 0. Otherwise `lastVisibleYear - firstActiveYear + 1`.
- **`islandRadius`.** `clamp(9 + 0.28 * spanYears, 9, 13)`.
- **`treeRingRadius`.** `max(7.4, 0.76 * islandRadius)`.
- **Year trees.** One per calendar year whose visible total is above 0, sorted by year ascending.
  - `scale = clamp(0.55 + 0.32 * log10(1 + total), 0.6, 1.9)`
  - `activeDays` is the number of visible days in that year with a count above 0.
  - `busiestMonth` is the month with the highest total; on a tie, the earliest month.
  - `evergreen` is `index % 4 === 3`.
- **Tree placement.** For n trees:
  - `theta0 = atan2(PATH_SLOPE, 1) + 0.35`.
  - Tree i starts at `theta_i = theta0 + i * (2π / max(n, 6))`, with a seeded jitter in ±0.08 rad.
  - Radius `r_i = treeRingRadius + jitter` in ±0.35.
  - Position: `x = r cos θ`, `z = r sin θ`.
  - If `distanceToPath(x, z) < 1.1`, add 0.3 rad and recompute. Do this at most 3 times.
  - `rotation` is a seeded value in [0, 2π).
  - All randomness comes from a deterministic PRNG seeded with `input.seed`. Use mulberry32; there's no shared one in `lib`, so write it in this file.
- **`distanceToPath`.** The perpendicular distance from (x, z) to the line `z = PATH_SLOPE·x + PATH_INTERCEPT`.
- **`greatTree`.**
  - Position `GREAT_TREE_POSITION`.
  - `scale = clamp(0.9 + 0.22 * log10(1 + lifetime), 0.9, 2.1)`.
  - `glowing = streak >= 365`.
- **`pond`.** `POND_POSITION`, with `scale = clamp(0.85 + 0.12 * log10(1 + repositories), 0.85, 1.25)`.
- **`flowerCount`.**
  - `seasonFactor`: spring 1.2, summer 1, autumn 0.6, winter 0.15.
  - `round(clamp(6 + 10 * log2(1 + prs + issues), 6, 110) * density * seasonFactor)`.
- **`butterflyCount`.**
  - Season not spring or summer: 0.
  - Otherwise, `activity <= 0.2` gives 0. Above that, `max(1, round(activity * 6))`.
- **`birdCount`.** `activity > 0.3 ? 2 + round(activity * 4) : 0`.
- **`fireflyCount`.** `streak >= 30 ? min(40, round(8 + streak / 10)) : 0`.
- **`shrubCount`.** `round(lerp(10, 16, rand) * density)`.
- **`rockCount`.** `round(lerp(8, 12, rand) * density)`. `rand` comes from the seeded PRNG.

**Tests** (write first, then watch them fail):

1. `intensityLevel` boundaries: 0, 1, 2, 3, 5, 6, 9, 10 and 500.
2. `bladesForDay`:
   - With density 1: 1→1, 2→2, 4→3, 31→5, 1000→6.
   - With density 0.5: 1→1, 1000→3.
   - 0 gives 0.
3. Light versus heavy. Build fixtures with a small helper that generates days.
   - **Light:** 23 active days spread over 2014–2018, summing to 40.
   - **Heavy:** every day from 2009-01-01 to 2026-11-20 with counts cycling 5–20, summing to roughly 80k.
   - Use the same seed and season "summer", density 1, activity 0.8, streak 3 (light) and 900 (heavy).
   - Assert:
     - heavy `islandRadius` > light;
     - heavy has 18 year trees and light has 5;
     - heavy's max tree scale ≥ 1.8 and light's ≤ 1.2;
     - heavy `greatTree.scale` > light's by at least 0.6;
     - heavy `fireflyCount` > 0 and light's is 0;
     - `greatTree.glowing` is true for heavy and false for light.
4. `visibleThrough` cuts off later years. With heavy and `visibleThrough` 2012-12-31, there are 4 year trees and the lifetime counts only through 2012.
5. Determinism. The same input gives a deep-equal layout. A different seed gives different tree positions but the same count.
6. No tree within 1.1 of the path. Check the heavy layout.
7. Year trees sit on the ring: every tree's `hypot(x, z)` is within 0.36 of `treeRingRadius`.
8. Empty days give `spanYears` 0, `islandRadius` 9, 0 trees, `greatTree.scale` 0.9 and lifetime 0.

Commit: "Add the pure garden data-to-layout mapping".

---

### Task 2: `world/palette.ts` (pure)

**Files**
- Create `components/garden/world/palette.ts`.
- Test in `tests/unit/garden-palette.test.ts`.

**Interface:**

```ts
import type { GardenSeason, GardenTimeOfDay } from "../types";

export interface WorldPalette {
  sky: string; horizon: string; fog: string;
  sun: string; sunIntensity: number;
  hemiSky: string; hemiGround: string; hemiIntensity: number;
  fill: string; fillIntensity: number;
  grass: [string, string];      // base, highlight
  grassDry: string; soil: string; earth: string; cliff: string; cliffLight: string;
  foliage: [string, string, string, string];
  evergreen: [string, string];
  trunk: string; stone: string; stoneLight: string;
  water: string; waterDeep: string; waterGlow: string;
  flowers: [string, string, string, string];
  blossom: string | null;       // spring canopy accent
  snow: string | null;          // winter ground and canopy dusting
  bareDeciduous: boolean;       // winter
  cloud: string;
}

export function worldPalette(season: GardenSeason, timeOfDay: GardenTimeOfDay): WorldPalette;
```

Season base values are in the spec. Use them exactly for summer, autumn and winter. For spring, use brighter, yellower greens (`#7fc24a`, `#9fd96a`, foliage `#5fae45 #78c257 #96d46e #b7e48a`) with blossom `#f6b8cf`.

Time of day adjusts sky, horizon, fog, sun, intensities and hemisphere:

| | sky | horizon | fog | sun | sunIntensity | hemiIntensity |
|---|---|---|---|---|---|---|
| morning | `#a9cfe8` | `#f6d6b8` | `#dfe8ec` | `#ffe0b8` | 2.3 | 1.0 |
| day | `#8fc8ec` | `#f3e3b8` | `#d9ecf3` | `#fff1c9` | 2.6 | 1.1 |
| sunset | `#f0a872` | `#ffd59a` | `#f2c9a8` | `#ffb46b` | 2.1 | 0.8 |
| night | `#16223a` | `#2b3d5c` | `#24324a` | `#b8c8ff` | 0.5 | 0.35 |

- Winter dims `sunIntensity` by 0.85 and uses sky `#c9dcea` during the day.
- `hemiSky` is `#cfe8ff` by day, `#ffd8b0` at sunset and `#2a3a5c` at night.
- `hemiGround` is the season's earth tone.
- `fill` is the horizon colour.
- `fillIntensity` is 0.35, or 0.1 at night.

**Tests:**
- Every colour string matches `/^#[0-9a-f]{6}$/i`, for all 16 combinations.
- Summer foliage: each colour's HSL saturation is at least 0.35, with hue in 80–140°. Write a small `hexToHsl` in the test.
- Autumn foliage: at least 3 of the 4 colours have hue in 0–50°.
- `snow` is set and `bareDeciduous` is true only in winter.
- `blossom` is set only in spring.
- Sunset's `sun` hue is in 15–45°.
- Night's `sunIntensity` is below 1.

Commit: "Add the vivid garden palette".

---

### Task 3: Sky, lights, tone mapping, tier settings, and island restyle

**Files**
- Create `components/garden/world/Sky.tsx`, `components/garden/world/Island.tsx` and `components/garden/world/tiers.ts`.
- Modify `components/garden/GardenScene.tsx` and `components/garden/photoreal-geometry.ts`.

**`tiers.ts`:**

```ts
export interface TierSettings {
  density: number;
  shadows: boolean;
  shadowMapSize: number;
  dpr: [number, number];
  bloom: boolean;
  vignette: boolean;
  mist: boolean;
  clouds: number;
}

export const TIER_SETTINGS: Record<GardenQuality, TierSettings>;
// low:    density 0.5, shadows off,         dpr [1,1],    bloom off, vignette off, mist off, clouds 3
// medium: density 0.8, shadows on, 1024,    dpr [1,1.25], bloom off, vignette on,  mist on,  clouds 5
// high:   density 1,   shadows on, 2048,    dpr [1,1.5],  bloom on,  vignette on,  mist on,  clouds 7
```

**Canvas** (in `GardenScene`):
- `gl.toneMapping = THREE.NeutralToneMapping` with exposure 1.0.
- dpr and shadows come from `TIER_SETTINGS`.
- The wrapper background is `worldPalette(...).sky`.

**`GardenWorld` changes:**
- Compute `const layout = useMemo(() => computeGardenLayout({...}), [...])`. Build its inputs from `days`, `visibleThrough`, `stats`, `health`, `season`, `seed` and the tier density.
- Compute `const palette = worldPalette(season, timeOfDay)`.
- Pass `layout` and `palette` down to the new components.
- The old `GardenPalette` and `paletteFor` may stay for now, but only if components not yet replaced still need them.

**`Sky.tsx`** exports `<SkyAndLights palette tier timeOfDay weather reducedMotion seed />`. It renders:
- the background colour and the fog;
- a gradient dome, horizon to zenith, using the new palette;
- a hemisphere light and a key directional light. Keep today's sun positions per time of day. It casts shadows when the tier has shadows: map size from the tier, frustum ±14, a small bias.
- a fill directional light;
- `tier.clouds` soft clouds. Each is 4–6 lit `MeshStandardMaterial` spheres in the cloud colour, roughness 1. They drift slowly on a ring of radius 16–22 at a height of 7–10. Stop the drift when `reducedMotion` is set.

Remove the old lights, `AtmosphereDome` and `CloudLayer`/`FogWisps` from `GardenWorld`. Keep `CelestialBody` only for night.

**`Island.tsx`** exports `<Island radius palette tier seed surfaceSampler />`:
- `createPhotorealIslandSurfaceSampler` and the geometry builder accept the radius. Change the clamp in `photoreal-geometry.ts` from 11–13 to 9–13. Use one geometry resolution per tier: low 64×16, medium 112×28, high 160×42.
- Materials are lit `MeshStandardMaterial` with vertex colours:
  - The grass top gets per-vertex greens. Blend `palette.grass[0]` toward `grass[1]` using value noise with a frequency of about 0.35, and add 6% brightness jitter.
  - The soil band uses `palette.soil` or `palette.earth`.
  - The cliff uses `palette.cliff`, with horizontal strata that alternate toward `cliffLight` by height.
  - Winter: the grass top uses `palette.snow`, with a light grey-blue variation.
- The surface sampler that other components use (meadow, trees and so on) must keep returning heights consistent with the mesh.
- Remove the use of `VoxelTerrain`, the medium-only branch, `CliffStrata` and `RimRocks`, and the tier switch inside `IslandTerrain`. Keep the pond rendering as it is for now. Task 4 replaces it, and it must sit correctly on the new terrain.

**Acceptance:**
- typecheck, lint, test:unit and `npm test` pass.
- `GardenScene` renders on every tier. No component left in `GardenWorld` uses `quality === "medium"` to switch art style.

Commit: "Restyle sky, light and island; one art style on every tier".

---

### Task 4: Water: pond and waterfall (`world/Water.tsx`)

Export `<Water layout palette tier surfaceSampler season weather reducedMotion onSelect stats health />`. Replace `PondWater`, `PondBankPlants` and `PondFish`.

**Pond**
- An elliptical water surface at `layout.pond`. Its semi-axes are today's 1.96 × 1.2, multiplied by `layout.pond.scale`.
- Material: `MeshStandardMaterial`, colour `palette.water`, roughness 0.15, metalness 0.05, opacity 0.92. Add a subtle moving normal map; reuse today's DataTexture normal approach. A thin `waterGlow` rim ring.
- Winter: frozen, with colour lerped toward the snow colour and roughness 0.4.
- Keep 2 fish when health > 0.42, on every tier.
- Keep reeds and lily pads around the bank. Reeds are hidden in winter.
- Selection payload is unchanged ("activity-pond").

**Waterfall**
- Find the rim point nearest the pond: sample angles and take the minimum distance from the pond centre to the rim.
- Draw an outflow channel: a narrow ribbon of water about 0.35 wide from the pond edge to the rim.
- Then draw a vertical stream down the cliff, about 4.5 units tall and 0.5 wide. It is a plane with a scrolling vertical gradient and a stripe texture. Animate it with `useFrame` UV offset, and keep it static when `reducedMotion` is set.
- Add a soft mist puff at the base and at the lip: about 30 small white `Points`, only when `tier.mist`.
- Winter: the stream is frozen. Use a static icy material and no mist.

**Acceptance:**
- Gates pass.
- The pond and waterfall appear on all tiers.
- Selection still works.

Commit: "Add a glossy pond and a waterfall over the island edge".

---

### Task 5: Meadow (`world/Meadow.tsx`)

Replace `GrassMeadow`.

- Keep the same year-ring day placement as `createContributionPlantings`: angle, ring radius, jitter, and path and pond avoidance. Move that function into `Meadow.tsx`, or a `meadow-layout.ts` beside it, unchanged except for these two things:
  - Blades per day come from `bladesForDay(count, tier.density)`.
  - The level comes from `intensityLevel(count)`, not `day.level`.
- Days after `visibleThrough` are skipped, as now.
- Blades are lit. Use `MeshStandardMaterial` with vertex colours, giving a base-to-tip gradient from a darker shade at the root to a lighter shade at the tip.
  - The colour comes from `palette.grass` and `palette.foliage`, keyed by level, with higher levels lusher and brighter.
  - In autumn, some tips go golden.
  - In winter, short frosted tufts.
- Sway gently in the vertex shader or with `useFrame`, except when `reducedMotion` is set. Use one `InstancedMesh`.
- Remove the high-only weekly patches. Remove `ContributionBedRibbons`.
- Selection payload is unchanged (kind "contribution", the same id, title and details). The details should show `Intensity` as `intensityLevel(count)/4`.

**Acceptance:**
- Gates pass.
- The grass is visibly denser and brighter for heavy users.

Commit: "Light the meadow and scale it by absolute daily activity".

---

### Task 6: Trees (`world/Trees.tsx`)

Replace `LightweightNature`, `TreeGrove` and `SpiritTree`.

**Shared builder**
- `buildTree(kind: "deciduous" | "evergreen" | "great", seed)` returns trunk and branch geometry plus canopy-cluster transforms.
- **Deciduous:** a tapered cylinder trunk with 2–3 branch stubs, and a canopy of 4–6 icosahedrons (detail 2) arranged in a dome.
- **Evergreen:** a trunk plus 3–4 stacked cones that narrow toward the top.
- **Great tree:** a thicker trunk with flared roots, and 7–9 canopy blobs in a wide umbrella like the landing image.

**Canopy material**
- `MeshStandardMaterial`, roughness 0.85, `vertexColors`.
- Bake a vertical gradient into the vertex colours: the bottom is 0.72× the base colour and the top is 1.12×.
- Each tree picks its base colour from `palette.foliage` with seeded hue and lightness jitter (±4%). Evergreens use `palette.evergreen`.
- Spring: about 30% of canopy blobs are tinted toward `palette.blossom`.
- Winter with `bareDeciduous`: deciduous trees show only trunk and branches, plus a few small snow-dusted tufts. Evergreens get white `palette.snow` tips. Blend the top 25% of vertex colours toward snow.

**Instancing**
- One `InstancedMesh` for all canopy blobs, one for trunks, and one for branches. Use per-instance colours, or bake the gradient into the geometry and set per-instance colour with `setColorAt`.
- Year trees are at `layout.yearTrees[i]` (x, z, rotation), at ground height from `surfaceSampler`, with `scale` applied to the whole tree. Year trees are 2.2–3.6 units tall at scale 1.
- The great tree is at `layout.greatTree`, about 5.5 units tall at scale 1, so about 11 at the maximum scale of 2.1. Make sure the default orbit camera still frames the island. If needed, adjust the Canvas camera position or the orbit `minDistance`/`maxDistance` proportionally to `islandRadius` and the great tree's height.
- When `glowing`, the great tree's canopy gets an emissive tint (`palette.waterGlow`, intensity 0.25) plus 7 slowly orbiting small glowing spheres. Keep them static when `reducedMotion` is set.

**Shadows:** trees cast and receive shadows when `tier.shadows`.

**Wind:** gentle canopy sway with `useFrame`, applied by updating instance matrices with damping. It is skipped when `reducedMotion` is set, and on low.

**Selection**
- Clicking a year tree (`instanceId` → tree) calls `onSelect` with:
  - kind "tree", id `year-tree-${year}`, title `${year}`, subtitle "A year of contributions"
  - description: "This tree grew from every contribution made in {year}."
  - details: Contributions, Busiest month (as a month name), Active days
  - `count`: the total
- The great tree uses the spec's payload: title "Great tree", id "great-tree", and kind "achievement" if the streak is 365 or more. Details: Lifetime contributions, Longest streak, Years growing (`spanYears`).

**Acceptance:**
- Gates pass.
- @octocat shows about 5 small trees and a modest great tree.
- @jeroen shows about 18 trees, many of them large, and a huge great tree.

Commit: "Grow one tree per year and a great tree for the lifetime total".

---

### Task 7: Flora (`world/Flora.tsx`)

Replace `FlowerField`, `StonePath`, `GroundDetails`, `EdgeUnderstory` and the shrubs and rocks inside `LightweightNature`.

**Path stones**
- Light flat stepping stones (`palette.stone`/`stoneLight`) along `PATH_SLOPE`/`PATH_INTERCEPT`, from x = −(R − 1.5) to (R − 1.5).
- Spacing about 0.95, with a sine wobble and a seeded size, at the surface height.

**Wildflowers**
- `layout.flowerCount` flowers. Each is a thin stem plus a head: a small icosahedron or a 5-petal cluster.
- Head colours come from `palette.flowers`, with lupine-like spikes (stacked small spheres) for the first colour.
- Scatter them with the seeded PRNG at radius 2.4 to (R − 1). Reject positions within 0.6 of the path, inside the pond ellipse plus 0.4, within 0.9 of a tree, or within 1.2 of the great tree.
- They come in small clusters of 3–7. Two instanced meshes: stems and heads.
- Clicking a flower calls `onSelect` with kind "flower", id `wildflower-${i}`, title "Wildflowers", and details "Pull requests (12 mo)" and "Issues (12 mo)".

**Shrubs and rocks**
- `layout.shrubCount` rounded shrubs, each a cluster of 2–3 icosahedrons in foliage colours, placed near the rim and around tree bases.
- `layout.rockCount` mossy rocks, flat-shaded and stone-coloured with a green top tint, near the rim and the pond.
- Use the same rejection rules as the wildflowers.

**Acceptance:**
- Gates pass.
- Flower count differs visibly between light and heavy users when their PRs and issues differ.

Commit: "Add wildflowers, stepping stones, shrubs and mossy rocks".

---

### Task 8: Life (`world/Life.tsx`)

Replace `Wildlife` and its low-only gating.

**Butterflies**
- `layout.butterflyCount` butterflies, each with two flapping wing planes in flower colours.
- They wander between flower clusters on smooth noise paths at a height of 0.6–1.6.

**Birds**
- `layout.birdCount` birds: simple V-shaped wing meshes.
- They circle in a loose flock at a height of 6–9 above the island at radius 6–10.

**Fireflies**
- `layout.fireflyCount` fireflies: small additive glowing points.
- They hover around the great tree and the meadow.
- Visible when `timeOfDay` is "sunset" or "night". At "day" and "morning" they show at a reduced opacity of 0.35, so the streak still shows.

**Motion:** everything is static, at a fixed pose, when `reducedMotion` is set. All three render on every tier.

**Acceptance:** gates pass.

Commit: "Bring butterflies, birds and fireflies to every quality tier".

---

### Task 9: Effects, camera and walkthrough fit (`world/Effects.tsx`)

**Effects**
- `<Effects tier />` uses `@react-three/postprocessing`'s `EffectComposer`.
  - When `tier.bloom`: `Bloom` with intensity 0.25, `luminanceThreshold` 0.85 and mipmapBlur.
  - When `tier.vignette`: `Vignette` with offset 0.32 and darkness 0.42.
- Low renders no composer at all.
- Check that the renderer's tone mapping is applied only once. If the composer disables renderer tone mapping, add the `ToneMapping` effect with `ToneMappingMode.NEUTRAL`.

**Camera framing**
- The default camera distance and the orbit limits scale with `layout.islandRadius` and the great tree's height, so a radius-9 island and a radius-13 island both fill the view.
- The flythrough path scales by `islandRadius / 11.5`.

**Walkthrough**
- The walkable test uses `layout.islandRadius - 0.7` instead of 10.78.
- Obstacles are every year tree (radius `0.45 * scale`) and the great tree (radius `1.0 * scale`).
- The pond obstacle uses `layout.pond.scale`.

**Acceptance:** gates pass. The controller checks framing for light and heavy users.

Commit: "Add tiered post-processing and fit camera and walking to the island".

---

### Task 10: Stats on desktop and the "Reading the garden" legend

**Files:**
- `components/ui/GardenUI.tsx`
- `components/ui/garden-ui.css`
- possibly `components/ContributionGarden.tsx`

**Desktop stats**
- In `presentation="cinematic"`, render `ProfileMetricsPanel compact` in `.cg-profile-position` on desktop (over 930 px).
- It stays hidden during flythrough and walking, using the existing `data-cinematic` and walking CSS.
- Make sure it doesn't overlap the season and weather controls (top centre), the experience controls (bottom right) or the timeline (bottom centre). Place it top-left, below the top bar, at a max width of about 300 px.

**Legend**
- A new `GardenLegend` component, rendered at the bottom of `ProfileMetricsPanel`, on both desktop and in the mobile Steward sheet.
- It's a `<details>` element with the summary "Reading the garden", plus 7 rows. Each row has a small icon (use the existing lucide icons) and a short line:
  - Trees: one per year, sized by that year's contributions
  - Great tree: your lifetime total
  - Meadow: every day you contributed; denser is more
  - Wildflowers: pull requests and issues this past year
  - Butterflies and birds: recent activity
  - Fireflies: a streak of 30+ days
  - Pond: public repositories
- Remember the open/closed state in `localStorage` under the key `cg-legend-open`. Wrap access in try/catch.
- It defaults to open on desktop and closed on mobile.
- For GitLab gardens, the row text stays the same, except the Wildflowers row reads "not available on GitLab".

**Tests:** in `tests/unit/garden-legend.test.tsx`, render `GardenLegend` with `renderToStaticMarkup`. Assert it has 7 rows and that the GitLab variant shows the GitLab text.

Commit: "Show garden stats on desktop with a legend for reading it".

---

### Task 11: Cleanup

Delete:
- `components/garden/PhotorealNature.tsx`, `VoxelTerrain.tsx` and `LightweightNature.tsx`
- every now-unused component or helper in `GardenScene.tsx`: old palettes, `QUALITY_MULTIPLIER`, `useSurfaceTextureSet` if unused, `ProceduralTreeBatch`, and the old tree builders
- `photoreal-geometry.ts` exports that are no longer used

`GardenScene.tsx` should end up holding the shell, signals, camera rigs and weather, plus `GardenWorld`'s composition. Aim for 1,800 lines or fewer.

Then:
- Run `npx tsc --noEmit` and lint to make sure nothing is unused. ESLint should catch unused imports.
- Run all gates.

Do NOT delete anything under `public/`.

Commit: "Remove the old tier-specific garden components".

---

### Task 12: Visual tuning (controller-led)

The controller compares @octocat, @jeroen and @timneutkens:
- in summer and autumn, at day and sunset;
- on desktop and at 375 px;
- on the high and low tiers.

Targeted tuning dispatches cover colour, scale, density and framing. Also check performance: `renderer.info.render.calls` ≤ 60 on high, and FPS ≥ 55 on the dev machine. Each tuning change is its own commit.

### Task 13: Final review, docs, PR
- A whole-branch code review, followed by fixes.
- Update the README's "Experience" section to describe the new mapping.
- Push `garden-restyle`, and open a PR with base `country-leaderboards`, since it's stacked.
