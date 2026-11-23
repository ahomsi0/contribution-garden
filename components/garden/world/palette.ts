import type { GardenSeason, GardenTimeOfDay } from "../types";

export interface WorldPalette {
  sky: string;
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
  daySky: string | null;
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
    grass: ["#8fae4f", "#b2c868"],
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
    foliage: ["#3a6f4a", "#4a8458", "#8fb09a", "#d6e4e4"],
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
    daySky: "#c9dcea",
  },
};

interface TimeBase {
  sky: string;
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
    sky: "#a9cfe8",
    horizon: "#f6d6b8",
    fog: "#dfe8ec",
    sun: "#ffe0b8",
    sunIntensity: 2.3,
    hemiSky: "#cfe8ff",
    hemiIntensity: 1.0,
    fillIntensity: 0.35,
  },
  day: {
    sky: "#8fc8ec",
    horizon: "#f3e3b8",
    fog: "#d9ecf3",
    sun: "#fff1c9",
    sunIntensity: 2.6,
    hemiSky: "#cfe8ff",
    hemiIntensity: 1.1,
    fillIntensity: 0.35,
  },
  sunset: {
    sky: "#f0a872",
    horizon: "#ffd59a",
    fog: "#f2c9a8",
    sun: "#ffb46b",
    sunIntensity: 2.1,
    hemiSky: "#ffd8b0",
    hemiIntensity: 0.8,
    fillIntensity: 0.35,
  },
  night: {
    sky: "#16223a",
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
    sky: season === "winter" && timeOfDay === "day" && daySky ? daySky : t.sky,
    horizon: t.horizon,
    fog: t.fog,
    sun: t.sun,
    sunIntensity: t.sunIntensity * (season === "winter" ? sunDim : 1),
    hemiSky: t.hemiSky,
    hemiGround: s.earth,
    hemiIntensity: t.hemiIntensity,
    fill: t.horizon,
    fillIntensity: t.fillIntensity,
  };
}
