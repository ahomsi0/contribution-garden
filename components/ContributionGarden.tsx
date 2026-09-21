"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  GardenQuality,
  GardenSelection,
  GardenWalkInput,
} from "@/components/garden/types";
import {
  GardenUI,
  type GardenAchievement,
  type GardenEntity,
  type GardenMetric,
  type GardenSeason as GardenUISeason,
  type GardenWalkDirection,
  type TimelineState,
} from "@/components/ui";
import { useAmbientSound } from "@/hooks/use-ambient-sound";
import { detectGardenQuality } from "@/lib/detect-quality";
import {
  useGardenStore,
  type SelectedGardenEntity,
  type Season,
  type TimeOfDay,
} from "@/lib/garden-store";
import type { ContributionDay, GitHubGardenData } from "@/lib/github-types";

const GardenScene = dynamic(
  () =>
    import("@/components/garden/GardenScene").then(
      (module) => module.GardenScene,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="garden-world-loading" role="status">
        <span className="garden-world-loading__mark" aria-hidden="true" />
        Preparing the trail…
      </div>
    ),
  },
);

function CinematicGardenBackdrop({ hidden }: { hidden: boolean }) {
  return (
    <div
      className={`garden-cinematic-backdrop${hidden ? " is-hidden" : ""}`}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/garden-hero-v4-voxel.webp"
        alt=""
        width="1672"
        height="941"
        decoding="async"
      />
      <span />
    </div>
  );
}

interface GrowthArchiveFrame {
  date: string;
  endIndex: number;
  contributions: number;
}

function emptyWalkInput(): GardenWalkInput {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
  };
}

function seasonForMonth(month: number): Season {
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

function timeForHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 9) return "morning";
  if (hour >= 9 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "sunset";
  return "night";
}

function createGrowthArchiveFrames(days: ContributionDay[]): GrowthArchiveFrame[] {
  let contributions = 0;
  const frames: GrowthArchiveFrame[] = [];

  days.forEach((day, index) => {
    contributions += day.count;
    const month = day.date.slice(0, 7);
    const nextMonth = days[index + 1]?.date.slice(0, 7);
    if (month !== nextMonth) {
      frames.push({
        date: day.date,
        endIndex: index,
        contributions,
      });
    }
  });

  return frames;
}

function archiveFrameIndex(timeline: number, frameCount: number) {
  if (frameCount <= 1) return 0;
  const normalized = Math.max(0, Math.min(100, timeline)) / 100;
  return Math.round(normalized * (frameCount - 1));
}

function timelineForArchiveFrame(index: number, frameCount: number) {
  if (frameCount <= 1) return 100;
  const clampedIndex = Math.max(0, Math.min(frameCount - 1, index));
  return (clampedIndex / (frameCount - 1)) * 100;
}

function longestActiveStreak(days: ContributionDay[]) {
  let longest = 0;
  let current = 0;
  for (const day of days) {
    if (day.count > 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function normalizeUsername(value: string): string | null {
  const username = value.trim().replace(/^@/, "");
  return /^(?!-)[a-zA-Z0-9-]{1,39}(?<!-)$/.test(username)
    ? username.toLowerCase()
    : null;
}

function selectionForUI(selection: GardenSelection | null): SelectedGardenEntity | null {
  if (!selection) return null;

  const kind = selection.kind === "contribution" ? "day" : selection.kind;

  return {
    id: selection.id,
    kind,
    title: selection.title,
    subtitle: selection.subtitle ?? selection.kind,
    date: selection.date,
    count: selection.count,
    repositories: selection.repositories,
    details: selection.description,
  };
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

export interface ContributionGardenProps {
  onReady?: () => void;
}

export default function ContributionGarden({
  onReady,
}: ContributionGardenProps) {
  const {
    username,
    data,
    status,
    season,
    weather,
    timeOfDay,
    timeline,
    isPlaying,
    isFlythrough,
    soundEnabled,
    selected,
    setUsername,
    setData,
    setStatus,
    setSeason,
    setWeather,
    setTimeOfDay,
    setTimeline,
    setPlaying,
    setFlythrough,
    setSoundEnabled,
    setSelected,
  } = useGardenStore();
  const [quality, setQuality] = useState<GardenQuality>("medium");
  // Live-tracked so toggling the OS setting takes effect without a reload.
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
  const [toast, setToast] = useState<{
    message: string;
    tone: "info" | "error";
  } | null>(null);
  const [searchValue, setSearchValue] = useState(username);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 4>(1);
  const [seasonMode, setSeasonMode] = useState<GardenUISeason>("auto");
  const [sceneKey, setSceneKey] = useState(0);
  const [isWalking, setIsWalking] = useState(false);
  const [walkInput, setWalkInput] = useState<GardenWalkInput>(emptyWalkInput);
  // The overview should open on the live 3D garden immediately after the
  // visitor enters. Walking remains an optional first-person mode.
  const [hasEnteredWorld, setHasEnteredWorld] = useState(true);
  const [interactiveSceneReady, setInteractiveSceneReady] = useState(false);
  const hasInitialized = useRef(false);
  const activeGardenRequest = useRef<AbortController | null>(null);
  const hasReportedReady = useRef(false);

  useAmbientSound(soundEnabled, weather, reducedMotion);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const params = new URLSearchParams(window.location.search);
    const requestedFromUrl = normalizeUsername(params.get("user") ?? "");
    const requested = requestedFromUrl ?? username;
    setUsername(requested);
    setSearchValue(requested);
    if (params.has("github")) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("github");
      window.history.replaceState({}, "", cleanUrl);
    }
    const now = new Date();
    setSeason(seasonForMonth(now.getMonth()));
    const localTime = timeForHour(now.getHours());
    setTimeOfDay(localTime === "night" ? "day" : localTime);

    setQuality(detectGardenQuality());
    // Run-once URL/store bootstrap; `username` is intentionally not a
    // dependency so later searches do not re-seed from the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSeason, setTimeOfDay, setUsername]);

  // Browser Back steps through shared ?user= gardens instead of leaving.
  useEffect(() => {
    const handlePopState = () => {
      const requested = normalizeUsername(
        new URLSearchParams(window.location.search).get("user") ?? "",
      );
      if (!requested) return;
      if (requested === useGardenStore.getState().username) return;
      setTimeline(100);
      setPlaying(false);
      setSelected(null);
      setUsername(requested);
      setSearchValue(requested);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setPlaying, setSelected, setTimeline, setUsername]);

  useEffect(() => {
    const controller = new AbortController();
    activeGardenRequest.current = controller;
    setStatus("loading");
    setSelected(null);

    async function loadGarden() {
      try {
        const headers = new Headers({ Accept: "application/json" });
        const response = await fetch(
          `/api/github/${encodeURIComponent(username)}`,
          {
            signal: controller.signal,
            headers,
            credentials: "same-origin",
            cache: "default",
          },
        );
        const payload = (await response.json()) as GitHubGardenData | { error?: string };
        // The username may have changed while the body was parsing; discard
        // stale payloads so a previous garden never lands in the store.
        if (controller.signal.aborted) return;
        if (!response.ok || !("profile" in payload)) {
          const message =
            "error" in payload && payload.error
              ? payload.error
              : "The garden could not be grown.";
          throw new Error(message);
        }
        setData(payload);
        if (payload.notice) setToast({ message: payload.notice, tone: "info" });
      } catch (requestError) {
        if (controller.signal.aborted) return;
        const message =
          requestError instanceof Error
            ? requestError.message
            : "The garden could not be grown.";
        setStatus("error", message);
        setToast({ message, tone: "error" });
      } finally {
        if (activeGardenRequest.current === controller) {
          activeGardenRequest.current = null;
          if (!hasReportedReady.current) {
            hasReportedReady.current = true;
            onReady?.();
          }
        }
      }
    }

    void loadGarden();
    return () => {
      controller.abort();
      if (activeGardenRequest.current === controller) {
        activeGardenRequest.current = null;
      }
    };
  }, [
    setData,
    setSelected,
    setStatus,
    onReady,
    username,
  ]);

  const archiveFrames = useMemo(
    () => createGrowthArchiveFrames(data?.calendar ?? []),
    [data?.calendar],
  );
  const activeArchiveFrameIndex = archiveFrameIndex(
    timeline,
    archiveFrames.length,
  );
  const activeArchiveFrame = archiveFrames[activeArchiveFrameIndex];
  const archiveTimelineValue = timelineForArchiveFrame(
    activeArchiveFrameIndex,
    archiveFrames.length,
  );
  const displayedDays = useMemo(() => {
    if (!data || !activeArchiveFrame) return [];
    return data.calendar.slice(0, activeArchiveFrame.endIndex + 1);
  }, [activeArchiveFrame, data]);

  useEffect(() => {
    if (!isPlaying) return;
    if (archiveFrames.length <= 1) {
      setPlaying(false);
      return;
    }

    const timer = window.setInterval(() => {
      const current = useGardenStore.getState().timeline;
      const currentFrame = archiveFrameIndex(current, archiveFrames.length);
      if (currentFrame >= archiveFrames.length - 1) {
        setPlaying(false);
        return;
      }
      const nextFrame = currentFrame + 1;
      setTimeline(
        timelineForArchiveFrame(nextFrame, archiveFrames.length),
      );
      if (nextFrame >= archiveFrames.length - 1) setPlaying(false);
    }, Math.round(520 / playbackSpeed));

    return () => window.clearInterval(timer);
  }, [
    archiveFrames.length,
    isPlaying,
    playbackSpeed,
    setPlaying,
    setTimeline,
  ]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const stats = useMemo(
    () => ({
      totalContributions: data?.metrics.totalContributions ?? 4862,
      commits: data?.metrics.commits ?? 3651,
      pullRequests: data?.metrics.pullRequests ?? 428,
      issues: data?.metrics.issues ?? 272,
      repositories: data?.metrics.repositories ?? 48,
      streak: data?.metrics.longestStreak ?? 187,
      stars: data?.metrics.stars ?? 784,
      followers: data?.metrics.followers ?? 512,
    }),
    [data],
  );

  const archiveStats = useMemo(() => {
    if (!data || archiveFrames.length === 0) return stats;
    const fullHistoryContributions =
      archiveFrames.at(-1)?.contributions ?? 0;
    const visibleContributions = activeArchiveFrame?.contributions ?? 0;
    const growth =
      fullHistoryContributions > 0
        ? visibleContributions / fullHistoryContributions
        : (activeArchiveFrame?.endIndex ?? 0) /
          Math.max(1, data.calendar.length - 1);
    const scaleMetric = (value: number, minimum = 0) =>
      value <= 0
        ? 0
        : Math.max(minimum, Math.round(value * Math.max(0, Math.min(1, growth))));

    return {
      totalContributions: scaleMetric(stats.totalContributions),
      commits: scaleMetric(stats.commits),
      pullRequests: stats.pullRequests,
      issues: stats.issues,
      repositories: stats.repositories,
      streak: longestActiveStreak(displayedDays),
      stars: stats.stars ?? 0,
      followers: stats.followers ?? 0,
    };
  }, [
    activeArchiveFrame,
    archiveFrames,
    data,
    displayedDays,
    stats,
  ]);

  const activity = useMemo(() => {
    if (!data) return 0.82;
    const recent = displayedDays.slice(-84);
    const activeDays = recent.filter((day) => day.count > 0).length;
    const density = activeDays / Math.max(1, recent.length);
    const intensity =
      recent.reduce((sum, day) => sum + Math.min(day.count, 12), 0) /
      Math.max(1, recent.length * 12);
    return Math.max(0.18, Math.min(1, density * 0.72 + intensity * 0.7));
  }, [data, displayedDays]);

  const archiveSeason = useMemo(() => {
    if (seasonMode !== "auto" || !activeArchiveFrame) return season;
    const frameDate = new Date(`${activeArchiveFrame.date}T12:00:00`);
    return seasonForMonth(frameDate.getMonth());
  }, [activeArchiveFrame, season, seasonMode]);

  const rollingYearActiveDays = useMemo(() => {
    if (!data?.calendar.length) return 0;
    const end = new Date(data.fetchedAt);
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    const startDate = start.toISOString().slice(0, 10);
    return data.calendar.filter((day) => day.date >= startDate && day.count > 0).length;
  }, [data]);

  const metrics = useMemo<GardenMetric[]>(
    () => [
      {
        key: "contributions",
        label: "Contributions",
        value: stats.totalContributions,
        detail: `${rollingYearActiveDays} active days · last year`,
      },
      { key: "commits", label: "Commits", value: stats.commits, detail: "Last year" },
      {
        key: "pullRequests",
        label: "Pull requests",
        value: stats.pullRequests,
        detail: "Last year",
      },
      { key: "issues", label: "Issues", value: stats.issues, detail: "Last year" },
      {
        key: "streak",
        label: "Longest streak",
        value: `${stats.streak}d`,
        detail: "Continuous bloom",
      },
      {
        key: "repositories",
        label: "Repositories",
        value: stats.repositories,
        detail: "Garden plots",
      },
      { key: "stars", label: "Stars", value: stats.stars ?? 0 },
      { key: "followers", label: "Followers", value: stats.followers ?? 0 },
    ],
    [rollingYearActiveDays, stats],
  );

  const achievements = useMemo<GardenAchievement[]>(() => {
    const years = data?.contributionYears.length ?? 1;
    const milestone = (threshold: number, value: number) =>
      Math.min(100, Math.round((value / threshold) * 100));
    return [
      {
        id: "butterfly-week",
        title: "Butterfly migration",
        description: "A seven-day streak brings the first butterflies.",
        unlocked: stats.streak >= 7,
        rarity: "common",
        progress: milestone(7, stats.streak),
      },
      {
        id: "rabbit-moon",
        title: "Moonlit rabbit trail",
        description: "Thirty days of steady care draws shy visitors.",
        unlocked: stats.streak >= 30,
        rarity: "rare",
        progress: milestone(30, stats.streak),
      },
      {
        id: "deer-crossing",
        title: "Deer crossing",
        description: "A hundred-day streak opens a hidden forest path.",
        unlocked: stats.streak >= 100,
        rarity: "rare",
        progress: milestone(100, stats.streak),
      },
      {
        id: "ancient-oak",
        title: "Ancient oak awakened",
        description: "One thousand contributions establish a permanent landmark.",
        unlocked: stats.totalContributions >= 1000,
        rarity: "legendary",
        progress: milestone(1000, stats.totalContributions),
      },
      {
        id: "waterfall",
        title: "The hidden waterfall",
        description: "One hundred repositories restore water to the high ridge.",
        unlocked: stats.repositories >= 100,
        rarity: "legendary",
        progress: milestone(100, stats.repositories),
      },
      {
        id: "aurora",
        title: "Aurora in the canopy",
        description: "A full year of consistency illuminates the night sky.",
        unlocked: stats.streak >= 365,
        rarity: "mythic",
        progress: milestone(365, stats.streak),
      },
      {
        id: "giant-forest",
        title: "The giant forest",
        description: "A decade of craft turns the garden into an old-growth realm.",
        unlocked: years >= 10,
        rarity: "mythic",
        progress: milestone(10, years),
      },
    ];
  }, [data?.contributionYears.length, stats]);

  const timelineState = useMemo<TimelineState>(() => {
    const firstFrame = archiveFrames[0];
    const lastFrame = archiveFrames.at(-1);
    const label = activeArchiveFrame
      ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(
          new Date(`${activeArchiveFrame.date}T12:00:00`),
        )
      : "Growing now";
    return {
      min: 0,
      max: 100,
      value: archiveTimelineValue,
      label,
      detail: `${(activeArchiveFrame?.contributions ?? 0).toLocaleString()} contributions through this month`,
      isPlaying,
      speed: playbackSpeed,
      startLabel: firstFrame?.date.slice(0, 4) ?? String(new Date().getFullYear()),
      endLabel: lastFrame?.date.slice(0, 4) ?? String(new Date().getFullYear()),
      canStepBackward: activeArchiveFrameIndex > 0,
      canStepForward:
        archiveFrames.length > 0 &&
        activeArchiveFrameIndex < archiveFrames.length - 1,
    };
  }, [
    activeArchiveFrame,
    activeArchiveFrameIndex,
    archiveFrames,
    archiveTimelineValue,
    isPlaying,
    playbackSpeed,
  ]);

  const selectedEntity = useMemo<GardenEntity | null>(() => {
    if (!selected) return null;
    const kind: GardenEntity["kind"] =
      selected.kind === "day"
        ? "plant"
        : selected.kind === "achievement"
          ? "landmark"
          : selected.kind === "water" ||
              selected.kind === "wildlife" ||
              selected.kind === "tree" ||
              selected.kind === "flower"
            ? selected.kind
            : "plant";
    return {
      id: selected.id,
      kind,
      eyebrow: selected.subtitle,
      title: selected.title,
      description: selected.details,
      date: selected.date,
      contributionCount: selected.count,
      repository: selected.repositories?.[0],
      status: activity > 0.7 ? "Thriving" : activity > 0.4 ? "Growing" : "Resting",
      accent:
        kind === "flower"
          ? "#dfad64"
          : kind === "tree"
            ? "#98aa73"
            : kind === "water"
              ? "#9bc8c2"
              : "#d7e5a4",
    };
  }, [activity, selected]);

  const handleWalkingChange = useCallback(
    (active: boolean) => {
      setWalkInput(emptyWalkInput());
      setIsWalking(active);
      if (active) {
        if (!hasEnteredWorld) {
          setInteractiveSceneReady(false);
          setHasEnteredWorld(true);
        }
        setPlaying(false);
        setFlythrough(false);
        setSelected(null);
      }
    },
    [hasEnteredWorld, setFlythrough, setPlaying, setSelected],
  );

  const handleWalkDirectionChange = useCallback(
    (direction: GardenWalkDirection, active: boolean) => {
      setWalkInput((current) =>
        current[direction] === active
          ? current
          : { ...current, [direction]: active },
      );
    },
    [],
  );

  useEffect(() => {
    if (!isWalking) return;
    const stopMovement = () => setWalkInput(emptyWalkInput());
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") stopMovement();
    };
    window.addEventListener("blur", stopMovement);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", stopMovement);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isWalking]);

  const handleSearch = useCallback(
    (value: string) => {
      const normalized = normalizeUsername(value);
      if (!normalized) {
        setToast({ message: "Use a valid GitHub username", tone: "error" });
        return;
      }
      setUsername(normalized);
      setSearchValue(normalized);
      setTimeline(100);
      setPlaying(false);
      setFlythrough(false);
      setIsWalking(false);
      setWalkInput(emptyWalkInput());
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("user", normalized);
      // Push so browser Back returns to the previously viewed garden.
      window.history.pushState({}, "", nextUrl);
    },
    [setFlythrough, setPlaying, setTimeline, setUsername],
  );

  const handleSelection = useCallback(
    (nextSelection: GardenSelection | null) => {
      setSelected(selectionForUI(nextSelection));
    },
    [setSelected],
  );

  const handleCinematicToggle = useCallback(() => {
    setIsWalking(false);
    setWalkInput(emptyWalkInput());
    setPlaying(false);
    if (!isFlythrough && !hasEnteredWorld) {
      setInteractiveSceneReady(false);
      setHasEnteredWorld(true);
    }
    setFlythrough(!isFlythrough);
  }, [hasEnteredWorld, isFlythrough, setFlythrough, setPlaying]);

  const handleResetView = useCallback(() => {
    setIsWalking(false);
    setWalkInput(emptyWalkInput());
    setFlythrough(false);
    if (hasEnteredWorld) {
      setInteractiveSceneReady(false);
      setSceneKey((key) => key + 1);
    }
  }, [hasEnteredWorld, setFlythrough]);

  const handleFlythroughComplete = useCallback(() => {
    setFlythrough(false);
  }, [setFlythrough]);

  const handleWalkthroughExit = useCallback(() => {
    handleWalkingChange(false);
  }, [handleWalkingChange]);

  const handleScreenshot = useCallback(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".garden-canvas canvas");
    if (!canvas) {
      setToast({
        message: "Walk in 3D before taking a garden photograph",
        tone: "info",
      });
      return;
    }
    const completeScreenshot = (blob: Blob | null) => {
      if (!blob) {
        setToast({ message: "Screenshot unavailable in this browser", tone: "error" });
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${username}-contribution-garden.png`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 500);
      setToast({ message: "Garden portrait saved", tone: "info" });
    };
    const captureEvent = new CustomEvent("contribution-garden:capture", {
      cancelable: true,
      detail: { complete: completeScreenshot },
    });
    window.dispatchEvent(captureEvent);
    if (!captureEvent.defaultPrevented) {
      canvas.toBlob(completeScreenshot, "image/png");
    }
  }, [username]);

  const handleShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast({ message: "Shareable garden link copied", tone: "info" });
    } catch {
      setToast({ message: "Copy the URL from your browser to share", tone: "info" });
    }
  }, []);

  const handleSeasonChange = useCallback(
    (nextSeason: GardenUISeason) => {
      setSeasonMode(nextSeason);
      setSeason(
        nextSeason === "auto" ? seasonForMonth(new Date().getMonth()) : nextSeason,
      );
    },
    [setSeason],
  );

  const handleTimelineChange = useCallback(
    (value: number) => {
      const frameIndex = archiveFrameIndex(value, archiveFrames.length);
      setTimeline(timelineForArchiveFrame(frameIndex, archiveFrames.length));
      setPlaying(false);
      setSelected(null);
    },
    [archiveFrames.length, setPlaying, setSelected, setTimeline],
  );

  const handleTimelineStep = useCallback(
    (direction: -1 | 1) => {
      const nextFrame = Math.max(
        0,
        Math.min(
          archiveFrames.length - 1,
          activeArchiveFrameIndex + direction,
        ),
      );
      setTimeline(timelineForArchiveFrame(nextFrame, archiveFrames.length));
      setPlaying(false);
      setSelected(null);
    },
    [
      activeArchiveFrameIndex,
      archiveFrames.length,
      setPlaying,
      setSelected,
      setTimeline,
    ],
  );

  const handlePlaybackToggle = useCallback(() => {
    if (archiveFrames.length <= 1) return;
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    if (activeArchiveFrameIndex >= archiveFrames.length - 1) {
      setTimeline(timelineForArchiveFrame(0, archiveFrames.length));
      setSelected(null);
    }
    setPlaying(true);
  }, [
    activeArchiveFrameIndex,
    archiveFrames.length,
    isPlaying,
    setPlaying,
    setSelected,
    setTimeline,
  ]);

  const profile = {
    login: data?.profile.login ?? username,
    name: data?.profile.name ?? "Garden caretaker",
    avatarUrl: data?.profile.avatarUrl,
    bio:
      data?.profile.bio ??
      "A living record of patient craft, quiet experiments, and code left better than it was found.",
    location: data?.profile.location,
    githubUrl: data?.profile.url,
    joinedYear: data ? new Date(data.profile.joinedAt).getFullYear() : undefined,
    followers: data?.profile.followers,
    repositories: data?.profile.repositories,
    stars: data?.profile.stars,
  };
  return (
    <main className="garden-app" aria-label="Contribution Garden">
      <GardenUI
        profile={profile}
        metrics={metrics}
        timeline={timelineState}
        achievements={achievements}
        selectedEntity={selectedEntity}
        season={seasonMode}
        weather={weather}
        searchValue={searchValue}
        ecosystemHealth={activity * 100}
        ambientSound={soundEnabled}
        cinematic={isFlythrough}
        walking={isWalking}
        isSearching={status === "loading"}
        onSearchValueChange={setSearchValue}
        onSearch={handleSearch}
        onSeasonChange={handleSeasonChange}
        onWeatherChange={setWeather}
        onTimelineChange={handleTimelineChange}
        onTimelineStep={handleTimelineStep}
        onPlaybackToggle={handlePlaybackToggle}
        onSpeedChange={setPlaybackSpeed}
        onAmbientSoundToggle={() => setSoundEnabled(!soundEnabled)}
        onCinematicToggle={handleCinematicToggle}
        onWalkingChange={handleWalkingChange}
        onWalkDirectionChange={handleWalkDirectionChange}
        onScreenshot={handleScreenshot}
        onShare={handleShare}
        onResetView={handleResetView}
        onEntityClose={() => setSelected(null)}
        onOpenProfile={() => {
          if (data?.profile.url) window.open(data.profile.url, "_blank", "noopener,noreferrer");
        }}
        dataSource={data?.source}
        presentation="cinematic"
      >
        <div className="garden-world">
          <CinematicGardenBackdrop
            hidden={hasEnteredWorld && interactiveSceneReady}
          />
          {hasEnteredWorld ? (
            <GardenScene
              key={sceneKey}
              className="garden-canvas"
              stats={archiveStats}
              days={data?.calendar ?? []}
              username={data?.profile.login ?? username}
              season={archiveSeason}
              weather={weather}
              timeOfDay={timeOfDay}
              visibleThrough={activeArchiveFrame?.date}
              activity={activity}
              flythrough={isFlythrough}
              walkthrough={isWalking}
              walkInput={walkInput}
              quality={quality}
              reducedMotion={reducedMotion}
              onReady={() => setInteractiveSceneReady(true)}
              onSelect={isWalking ? undefined : handleSelection}
              onFlythroughComplete={handleFlythroughComplete}
              onWalkthroughExit={handleWalkthroughExit}
            />
          ) : null}
        </div>
      </GardenUI>

      <AnimatePresence>
        {status === "loading" && !data ? (
          <motion.div
            className="garden-loading"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
          >
            <div className="garden-loading__mark" />
            <span className="sr-only">Growing {username}&apos;s garden…</span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {toast ? (
          <motion.div
            className="garden-toast"
            role={toast.tone === "error" ? "alert" : "status"}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            {toast.message}
          </motion.div>
        ) : null}
      </AnimatePresence>

    </main>
  );
}
