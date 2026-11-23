"use client";

import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";

import type { GardenQuality } from "../types";
import {
  createPhotorealIslandGeometry,
  paintPhotorealIsland,
} from "../photoreal-geometry";
import type { WorldPalette } from "./palette";
import type { TierSettings } from "./tiers";

/**
 * The island mesh is lowered by this much. Anything placed with the shared
 * surface sampler adds it to the sampled height so it sits on the mesh.
 */
export const ISLAND_SURFACE_OFFSET = -0.7;

export interface IslandProps {
  radius: number;
  palette: WorldPalette;
  tier: TierSettings;
  /** Picks the mesh resolution: low 64×16, medium 112×28, high 160×42. */
  quality: GardenQuality;
  seed: number;
}

export function Island({ radius, palette, tier, quality, seed }: IslandProps) {
  const [grassBase, grassHighlight] = palette.grass;
  const { soil, earth, cliff, cliffLight, snow } = palette;

  // The mesh depends only on the island's size, resolution and seed. A season
  // or time-of-day change repaints its vertex colours in place.
  const geometry = useMemo(
    () => createPhotorealIslandGeometry({ radius, quality, seed }),
    [quality, radius, seed],
  );
  useLayoutEffect(() => {
    paintPhotorealIsland(
      geometry,
      {
        grass: [grassBase, grassHighlight],
        soil,
        earth,
        cliff,
        cliffLight,
        snow,
      },
      seed,
    );
  }, [cliff, cliffLight, earth, geometry, grassBase, grassHighlight, seed, snow, soil]);

  // Material order follows PHOTOREAL_ISLAND_MATERIAL_INDEX: cliff, ground, soil.
  const materials = useMemo(
    () => [
      new THREE.MeshStandardMaterial({
        name: "island-cliff",
        flatShading: true,
        roughness: 0.95,
        vertexColors: true,
      }),
      new THREE.MeshStandardMaterial({
        name: "island-ground",
        roughness: 0.9,
        vertexColors: true,
      }),
      new THREE.MeshStandardMaterial({
        name: "island-soil",
        flatShading: true,
        roughness: 0.95,
        vertexColors: true,
      }),
    ],
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(
    () => () => materials.forEach((material) => material.dispose()),
    [materials],
  );

  return (
    <mesh
      name="island"
      // Only trees, shrubs and rocks cast; the island just receives.
      receiveShadow={tier.shadows}
      geometry={geometry}
      material={materials}
      position={[0, ISLAND_SURFACE_OFFSET, 0]}
    />
  );
}
