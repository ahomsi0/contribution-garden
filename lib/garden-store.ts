import { create } from "zustand";
import type { GitHubGardenData } from "./github-types";

export type Season = "spring" | "summer" | "autumn" | "winter";
export type Weather = "sunny" | "rain" | "fog" | "snow" | "wind";
export type TimeOfDay = "morning" | "day" | "sunset" | "night";

export interface SelectedGardenEntity {
  id: string;
  kind: "day" | "tree" | "flower" | "achievement" | "water" | "wildlife";
  title: string;
  subtitle?: string;
  date?: string;
  count?: number;
  repositories?: string[];
  details?: string;
}

interface GardenState {
  username: string;
  data: GitHubGardenData | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  season: Season;
  weather: Weather;
  timeOfDay: TimeOfDay;
  timeline: number;
  isPlaying: boolean;
  isFlythrough: boolean;
  soundEnabled: boolean;
  selected: SelectedGardenEntity | null;
  setUsername: (username: string) => void;
  setData: (data: GitHubGardenData) => void;
  setStatus: (status: GardenState["status"], error?: string | null) => void;
  setSeason: (season: Season) => void;
  setWeather: (weather: Weather) => void;
  setTimeOfDay: (time: TimeOfDay) => void;
  setTimeline: (timeline: number) => void;
  setPlaying: (playing: boolean) => void;
  setFlythrough: (active: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setSelected: (selected: SelectedGardenEntity | null) => void;
}

export const useGardenStore = create<GardenState>((set) => ({
  username: "octocat",
  data: null,
  status: "idle",
  error: null,
  season: "summer",
  weather: "sunny",
  timeOfDay: "sunset",
  timeline: 100,
  isPlaying: false,
  isFlythrough: false,
  soundEnabled: false,
  selected: null,
  setUsername: (username) => set({ username }),
  setData: (data) => set({ data, status: "ready", error: null }),
  setStatus: (status, error = null) => set({ status, error }),
  setSeason: (season) => set({ season }),
  setWeather: (weather) => set({ weather }),
  setTimeOfDay: (timeOfDay) => set({ timeOfDay }),
  setTimeline: (timeline) => set({ timeline: Math.max(0, Math.min(100, timeline)) }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setFlythrough: (isFlythrough) => set({ isFlythrough }),
  setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
  setSelected: (selected) => set({ selected }),
}));
