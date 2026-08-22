export type GardenSeason = "spring" | "summer" | "autumn" | "winter";

export type GardenWeather = "sunny" | "rain" | "fog" | "snow" | "wind";

export type GardenTimeOfDay = "morning" | "day" | "sunset" | "night";

export type GardenQuality = "low" | "medium" | "high";

export interface GardenStats {
  totalContributions: number;
  commits: number;
  pullRequests: number;
  issues: number;
  repositories: number;
  streak: number;
  stars?: number;
  followers?: number;
}

export interface GardenDay {
  date: string;
  count: number;
  level: number;
  repositories?: string[];
}

export type GardenSelectionKind =
  | "contribution"
  | "tree"
  | "flower"
  | "water"
  | "achievement";

export interface GardenSelectionDetail {
  label: string;
  value: string | number;
}

export interface GardenSelection {
  kind: GardenSelectionKind;
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  accent: string;
  worldPosition: [number, number, number];
  date?: string;
  count?: number;
  repositories?: string[];
  details: GardenSelectionDetail[];
}

export interface GardenWalkInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint?: boolean;
}

export interface GardenSceneProps {
  stats: GardenStats;
  days?: GardenDay[];
  username?: string;
  season: GardenSeason;
  weather: GardenWeather;
  timeOfDay: GardenTimeOfDay;
  /** ISO date through which daily plots are revealed during timeline playback. */
  visibleThrough?: string;
  /** A normalized 0..1 activity/health value. Derived from contribution data when omitted. */
  activity?: number;
  flythrough?: boolean;
  walkthrough?: boolean;
  walkInput?: GardenWalkInput;
  quality?: GardenQuality;
  reducedMotion?: boolean;
  className?: string;
  onReady?: () => void;
  onSelect?: (selection: GardenSelection | null) => void;
  onFlythroughComplete?: () => void;
  onWalkthroughExit?: () => void;
}
