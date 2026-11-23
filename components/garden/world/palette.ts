import type { GardenSeason, GardenTimeOfDay } from "../types";

export interface WorldPalette {
  /** Sky gradient, top to bottom: zenith, upper, lower, horizon glow. */
  sky: string;
  skyMid: string;
  skyLow: string;
  horizon: string;
  fog: string;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fill: string;
  fillIntensity: number;
  grass: [string, string]; // base, highlight
  grassDry: string;
  soil: string;
  earth: string;
  cliff: string;
  cliffLight: string;
  foliage: [string, string, string, string];
  evergreen: [string, string];
  trunk: string;
  stone: string;
  stoneLight: string;
  water: string;
  waterDeep: string;
  waterGlow: string;
  flowers: [string, string, string, string];
  blossom: string | null; // spring canopy accent
  snow: string | null; // winter ground and canopy dusting
  bareDeciduous: boolean; // winter
  cloud: string;
}

interface SeasonBase {
  grass: [string, string];
  grassDry: string;
  soil: string;
  earth: string;
  cliff: string;
  cliffLight: string;
  foliage: [string, string, string, string];
  evergreen: [string, string];
  trunk: string;
  stone: string;
  stoneLight: string;
  water: string;
  waterDeep: string;
  waterGlow: string;
  flowers: [string, string, string, string];
  blossom: string | null;
  snow: string | null;
  bareDeciduous: boolean;
  cloud: string;
  sunDim: number;
  /** A paler daytime sky gradient for the season, or null for the default. */
  daySky: { sky: string; skyMid: string; skyLow: string } | null;
}

const SEASONS: Record<GardenSeason, SeasonBase> = {
  spring: {
    grass: ["#7fc24a", "#9fd96a"],
    grassDry: "#b5cf6a",
    soil: "#6b4a32",
    earth: "#5a4330",
    cliff: "#7b6a58",
    cliffLight: "#a08c76",
    foliage: ["#5fae45", "#78c257", "#96d46e", "#b7e48a"],
    evergreen: ["#3f8a45", "#2f7a3c"],
    trunk: "#6b4a32",
    stone: "#bdb5a4",
    stoneLight: "#d8d2c4",
    water: "#3fa7b8",
    waterDeep: "#2a8499",
    waterGlow: "#8fe0e6",
    flowers: ["#f6b8cf", "#fff3a8", "#ffffff", "#b79cf0"],
    blossom: "#f6b8cf",
    snow: null,
    bareDeciduous: false,
    cloud: "#ffffff",
    sunDim: 1,
    daySky: null,
  },
  summer: {
    grass: ["#6fae3f", "#9ccc5a"],
    grassDry: "#b4c25a",
    soil: "#6b4a32",
    earth: "#5a4330",
    cliff: "#7b6a58",
    cliffLight: "#a08c76",
    foliage: ["#3f8f3a", "#57a845", "#7cc05a", "#a6d96a"],
    evergreen: ["#2f7a3c", "#3f8f4a"],
    trunk: "#6b4a32",
    stone: "#bdb5a4",
    stoneLight: "#d8d2c4",
    water: "#3fa7b8",
    waterDeep: "#2a8499",
    waterGlow: "#8fe0e6",
    flowers: ["#8b6fd6", "#f2c94c", "#ffffff", "#e86f9c"],
    blossom: null,
    snow: null,
    bareDeciduous: false,
    cloud: "#ffffff",
    sunDim: 1,
    daySky: null,
  },
  autumn: {
    // Still a touch golden, but green enough to read as grass at sunset.
    grass: ["#7fb444", "#a5cf5c"],
    grassDry: "#c4a84a",
    soil: "#6b4a32",
    earth: "#5a4330",
    cliff: "#7b6a58",
    cliffLight: "#a08c76",
    foliage: ["#d9822b", "#e8a33d", "#c0472d", "#f2c14e"],
    evergreen: ["#3f7a45", "#2f6a3c"],
    trunk: "#6b4a32",
    stone: "#bdb5a4",
    stoneLight: "#d8d2c4",
    water: "#3fa7b8",
    waterDeep: "#2a8499",
    waterGlow: "#8fe0e6",
    flowers: ["#e8873a", "#f2c94c", "#d8506a", "#a66bd6"],
    blossom: null,
    snow: null,
    bareDeciduous: false,
    cloud: "#fff4e6",
    sunDim: 1,
    daySky: null,
  },
  winter: {
    grass: ["#eef3f5", "#ffffff"],
    grassDry: "#c9d6dc",
    soil: "#6b5a4a",
    earth: "#5a4a40",
    cliff: "#7b7468",
    cliffLight: "#a9a39a",
    // [2] colours the frosted twig tufts on bare trees; it stays a pale,
    // cool sage so warm evening light can't turn it olive.
    foliage: ["#3a6f4a", "#4a8458", "#b2c6c0", "#d6e4e4"],
    evergreen: ["#3a6f4a", "#2d5c3e"],
    trunk: "#5a4332",
    stone: "#c4c4bf",
    stoneLight: "#e4e6e4",
    water: "#4aa0bd",
    waterDeep: "#2f7f9e",
    waterGlow: "#a8e6f0",
    flowers: ["#d8506a", "#ffffff", "#8b6fd6", "#f2c94c"],
    blossom: null,
    snow: "#eef3f5",
    bareDeciduous: true,
    cloud: "#f4f8fb",
    sunDim: 0.85,
    daySky: { sky: "#b4cfe8", skyMid: "#cadeee", skyLow: "#e0ebf2" },
  },
};

interface TimeBase {
  sky: string;
  skyMid: string;
  skyLow: string;
  horizon: string;
  fog: string;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiIntensity: number;
  fillIntensity: number;
}

const TIMES: Record<GardenTimeOfDay, TimeBase> = {
  morning: {
    // Pale blue overhead, warming to a pink dawn glow.
    sky: "#9cc4ea",
    skyMid: "#cdd5ee",
    skyLow: "#f3c6c6",
    horizon: "#fbdcc8",
    fog: "#dfe8ec",
    sun: "#ffe0b8",
    sunIntensity: 2.3,
    hemiSky: "#cfe8ff",
    hemiIntensity: 1.0,
    fillIntensity: 0.35,
  },
  day: {
    sky: "#86c2ec",
    skyMid: "#a9d4f1",
    skyLow: "#cfe7f2",
    horizon: "#f3e3b8",
    fog: "#d9ecf3",
    sun: "#fff1c9",
    sunIntensity: 2.6,
    hemiSky: "#cfe8ff",
    hemiIntensity: 1.1,
    fillIntensity: 0.35,
  },
  sunset: {
    // Blue-violet overhead through mauve to a warm glow: golden hour on a
    // green garden. The sky light stays cool so the grass keeps its green
    // under the orange sun.
    sky: "#6f86c9",
    skyMid: "#c49ab8",
    skyLow: "#f0a872",
    horizon: "#ffd59a",
    fog: "#f2c9a8",
    sun: "#ffc58a",
    sunIntensity: 2.1,
    hemiSky: "#9fb7e8",
    hemiIntensity: 0.8,
    fillIntensity: 0.35,
  },
  night: {
    sky: "#121c33",
    skyMid: "#1a2742",
    skyLow: "#22324f",
    horizon: "#2b3d5c",
    fog: "#24324a",
    sun: "#b8c8ff",
    sunIntensity: 0.5,
    hemiSky: "#2a3a5c",
    hemiIntensity: 0.35,
    fillIntensity: 0.1,
  },
};

export function worldPalette(season: GardenSeason, timeOfDay: GardenTimeOfDay): WorldPalette {
  const s = SEASONS[season];
  const t = TIMES[timeOfDay];
  const { sunDim, daySky, ...seasonColours } = s;
  return {
    ...seasonColours,
    ...(season === "winter" && timeOfDay === "day" && daySky
      ? daySky
      : { sky: t.sky, skyMid: t.skyMid, skyLow: t.skyLow }),
    horizon: t.horizon,
    fog: t.fog,
    sun: t.sun,
    // A low morning or evening sun already keeps snow from blowing out, so
    // the winter dimming applies only to the high sun and the moon.
    sunIntensity:
      t.sunIntensity *
      (season === "winter" && timeOfDay !== "morning" && timeOfDay !== "sunset"
        ? sunDim
        : 1),
    hemiSky: t.hemiSky,
    hemiGround: s.earth,
    hemiIntensity: t.hemiIntensity,
    fill: t.horizon,
    fillIntensity: t.fillIntensity,
  };
}
