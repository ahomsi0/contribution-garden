import type { GardenQuality } from "../types";

/**
 * What a quality tier changes. Every tier renders the same scene in the same
 * art style; a tier only scales density, shadows, resolution and effects.
 */
export interface TierSettings {
  /** Multiplier for instance counts (grass, flowers, decoration). */
  density: number;
  shadows: boolean;
  shadowMapSize: number;
  dpr: [number, number];
  bloom: boolean;
  vignette: boolean;
  mist: boolean;
  clouds: number;
}

export const TIER_SETTINGS: Record<GardenQuality, TierSettings> = {
  low: {
    density: 0.5,
    shadows: false,
    shadowMapSize: 0,
    dpr: [1, 1],
    bloom: false,
    vignette: false,
    mist: false,
    clouds: 3,
  },
  medium: {
    density: 0.8,
    shadows: true,
    shadowMapSize: 1024,
    dpr: [1, 1.25],
    bloom: false,
    vignette: true,
    mist: true,
    clouds: 5,
  },
  high: {
    density: 1,
    shadows: true,
    shadowMapSize: 2048,
    dpr: [1, 1.5],
    bloom: true,
    vignette: true,
    mist: true,
    clouds: 7,
  },
};
