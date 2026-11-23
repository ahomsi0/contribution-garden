import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  createPhotorealIslandGeometry,
  createPhotorealIslandSurfaceSampler,
  paintPhotorealIsland,
  PHOTOREAL_ISLAND_MATERIAL_INDEX,
} from "@/components/garden/photoreal-geometry";
import { worldPalette } from "@/components/garden/world/palette";
import { TIER_SETTINGS } from "@/components/garden/world/tiers";

function groundVertices(geometry: THREE.BufferGeometry) {
  const index = geometry.getIndex()!;
  const ground = geometry.groups.find(
    (group) => group.materialIndex === PHOTOREAL_ISLAND_MATERIAL_INDEX.ground,
  )!;
  const vertices = new Set<number>();
  for (let cursor = ground.start; cursor < ground.start + ground.count; cursor += 1) {
    vertices.add(index.getX(cursor));
  }
  return [...vertices];
}

test("the surface sampler matches the island mesh at every radius", () => {
  for (const radius of [9, 10.4, 13]) {
    for (const seed of [1, 987654321]) {
      const geometry = createPhotorealIslandGeometry({ radius, quality: "low", seed });
      const sampler = createPhotorealIslandSurfaceSampler({ radius, quality: "low", seed });
      const position = geometry.getAttribute("position");
      let checked = 0;
      for (const vertex of groundVertices(geometry)) {
        const x = position.getX(vertex);
        const z = position.getZ(vertex);
        const sampled = sampler(x, z);
        // Float32 rounding can push an exact rim vertex just outside.
        if (sampled === null) continue;
        assert.ok(
          Math.abs(sampled - position.getY(vertex)) < 1e-3,
          `radius ${radius}: vertex ${vertex} off by ${sampled - position.getY(vertex)}`,
        );
        checked += 1;
      }
      assert.ok(checked > 500);
      geometry.dispose();
    }
  }
});

test("the island radius clamps to 9–13", () => {
  const small = createPhotorealIslandGeometry({ radius: 4, quality: "low", seed: 3 });
  const large = createPhotorealIslandGeometry({ radius: 40, quality: "low", seed: 3 });
  assert.equal(small.userData.maximumRadius, 9);
  assert.equal(large.userData.maximumRadius, 13);
  assert.ok(createPhotorealIslandSurfaceSampler({ radius: 9, quality: "low", seed: 3 })(9.5, 0) === null);
});

test("painting gives a green top in summer and a snowy top in winter", () => {
  for (const season of ["summer", "winter"] as const) {
    const palette = worldPalette(season, "day");
    const geometry = createPhotorealIslandGeometry({ radius: 10, quality: "low", seed: 11 });
    paintPhotorealIsland(geometry, { ...palette, grass: palette.grass }, 11);
    const color = geometry.getAttribute("color");
    assert.equal(color.count, geometry.getAttribute("position").count);
    for (const vertex of groundVertices(geometry).slice(0, 200)) {
      const r = color.getX(vertex);
      const g = color.getY(vertex);
      const b = color.getZ(vertex);
      if (season === "summer") {
        assert.ok(g > r && g > b, `vertex ${vertex} is not green`);
      } else {
        assert.ok(r > 0.6 && g > 0.6 && b > 0.6, `vertex ${vertex} is not snowy`);
      }
    }
    geometry.dispose();
  }
});

test("repainting for a new season reuses the colour attribute in place", () => {
  const geometry = createPhotorealIslandGeometry({ radius: 10, quality: "low", seed: 11 });
  const summer = worldPalette("summer", "day");
  const winter = worldPalette("winter", "day");
  paintPhotorealIsland(geometry, summer, 11);
  const attribute = geometry.getAttribute("color");
  const version = (attribute as { version: number }).version;
  const vertex = groundVertices(geometry)[0];
  const summerGreen = attribute.getY(vertex);
  paintPhotorealIsland(geometry, winter, 11);
  assert.equal(geometry.getAttribute("color"), attribute);
  assert.ok((attribute as { version: number }).version > version, "marked for upload");
  assert.notEqual(attribute.getY(vertex), summerGreen);
  geometry.dispose();
});

test("tier settings only scale density, shadows, resolution and effects", () => {
  assert.equal(TIER_SETTINGS.low.shadows, false);
  assert.equal(TIER_SETTINGS.medium.shadowMapSize, 1024);
  assert.equal(TIER_SETTINGS.high.shadowMapSize, 2048);
  assert.deepEqual(
    [TIER_SETTINGS.low.clouds, TIER_SETTINGS.medium.clouds, TIER_SETTINGS.high.clouds],
    [3, 5, 7],
  );
  assert.ok(TIER_SETTINGS.low.density < TIER_SETTINGS.medium.density);
  assert.ok(TIER_SETTINGS.medium.density < TIER_SETTINGS.high.density);
});
