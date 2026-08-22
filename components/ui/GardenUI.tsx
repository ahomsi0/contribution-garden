"use client";

import {
  Award,
  Bird,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudFog,
  CloudRain,
  CloudSnow,
  Code2,
  ExternalLink,
  FastForward,
  Flower2,
  Footprints,
  Headphones,
  Leaf,
  LocateFixed,
  MapPin,
  Maximize2,
  Menu,
  MoonStar,
  Mountain,
  Pause,
  Play,
  Search,
  Share2,
  Sparkles,
  Sprout,
  Sun,
  Trees,
  UserRound,
  Volume2,
  VolumeX,
  Waves,
  Wind,
  X,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "framer-motion";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GitHubDataSource } from "@/lib/github-types";

import "./garden-ui.css";

export type GardenSeason =
  | "auto"
  | "spring"
  | "summer"
  | "autumn"
  | "winter";

export type GardenWeather = "sunny" | "rain" | "fog" | "snow" | "wind";

export type GardenWalkDirection =
  | "forward"
  | "backward"
  | "left"
  | "right";

export type GardenEntityKind =
  | "tree"
  | "flower"
  | "plant"
  | "water"
  | "wildlife"
  | "landmark";

export type GardenMetricKey =
  | "contributions"
  | "commits"
  | "pullRequests"
  | "issues"
  | "streak"
  | "repositories"
  | "stars"
  | "followers";

export interface GardenProfile {
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  location?: string | null;
  githubUrl?: string | null;
  joinedYear?: number | null;
  followers?: number;
  repositories?: number;
  stars?: number;
}

export interface GardenMetric {
  key: GardenMetricKey;
  label: string;
  value: number | string;
  detail?: string;
}

export interface GardenFact {
  label: string;
  value: string;
}

export interface GardenEntity {
  id: string;
  kind: GardenEntityKind;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  description?: string;
  date?: string;
  repository?: string;
  contributionCount?: number;
  status?: string;
  facts?: GardenFact[];
  accent?: string;
  href?: string;
}

export interface GardenAchievement {
  id: string;
  title: string;
  description?: string;
  unlocked?: boolean;
  rarity?: "common" | "rare" | "legendary" | "mythic";
  progress?: number;
}

export interface TimelineState {
  min: number;
  max: number;
  value: number;
  label: string;
  detail?: string;
  isPlaying?: boolean;
  speed?: 1 | 2 | 4;
  startLabel?: string;
  endLabel?: string;
  canStepBackward?: boolean;
  canStepForward?: boolean;
}

export interface GardenUIProps {
  profile: GardenProfile;
  metrics: GardenMetric[];
  timeline: TimelineState;
  achievements?: GardenAchievement[];
  selectedEntity?: GardenEntity | null;
  season?: GardenSeason;
  weather?: GardenWeather;
  searchValue?: string;
  ecosystemHealth?: number;
  ambientSound?: boolean;
  cinematic?: boolean;
  walking?: boolean;
  isSearching?: boolean;
  className?: string;
  children?: ReactNode;
  onSearchValueChange?: (value: string) => void;
  onSearch?: (username: string) => void;
  onSeasonChange?: (season: GardenSeason) => void;
  onWeatherChange?: (weather: GardenWeather) => void;
  onTimelineChange?: (value: number) => void;
  onTimelineStep?: (direction: -1 | 1) => void;
  onPlaybackToggle?: () => void;
  onSpeedChange?: (speed: 1 | 2 | 4) => void;
  onAmbientSoundToggle?: () => void;
  onCinematicToggle?: () => void;
  onWalkingChange?: (active: boolean) => void;
  onWalkDirectionChange?: (
    direction: GardenWalkDirection,
    active: boolean,
  ) => void;
  onScreenshot?: () => void;
  onShare?: () => void;
  onResetView?: () => void;
  onEntityClose?: () => void;
  onOpenProfile?: () => void;
  dataSource?: GitHubDataSource;
  presentation?: "field" | "cinematic";
}

interface IconButtonProps {
  label: string;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

const metricIcons: Record<GardenMetricKey, typeof Sprout> = {
  contributions: Sprout,
  commits: Leaf,
  pullRequests: Trees,
  issues: Flower2,
  streak: Sparkles,
  repositories: Code2,
  stars: Award,
  followers: UserRound,
};

const entityIcons: Record<GardenEntityKind, typeof Sprout> = {
  tree: Trees,
  flower: Flower2,
  plant: Sprout,
  water: Waves,
  wildlife: Bird,
  landmark: Mountain,
};

const seasons: Array<{
  value: GardenSeason;
  label: string;
  shortLabel: string;
}> = [
  { value: "auto", label: "Natural cycle", shortLabel: "Auto" },
  { value: "spring", label: "Spring", shortLabel: "Spr" },
  { value: "summer", label: "Summer", shortLabel: "Sum" },
  { value: "autumn", label: "Autumn", shortLabel: "Aut" },
  { value: "winter", label: "Winter", shortLabel: "Win" },
];

const weatherOptions: Array<{
  value: GardenWeather;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "sunny", label: "Clear", icon: Sun },
  { value: "rain", label: "Rain", icon: CloudRain },
  { value: "fog", label: "Fog", icon: CloudFog },
  { value: "snow", label: "Snow", icon: CloudSnow },
  { value: "wind", label: "Wind", icon: Wind },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatMetric(value: number | string) {
  if (typeof value === "string") return value;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  return new Intl.NumberFormat("en-US").format(value);
}

function IconButton({
  label,
  children,
  active,
  disabled,
  onClick,
  className,
}: IconButtonProps) {
  return (
    <button
      className={cx("cg-icon-button", active && "is-active", className)}
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export interface GardenBrandProps {
  onMenu?: () => void;
  menuOpen?: boolean;
}

export function GardenBrand({ onMenu, menuOpen }: GardenBrandProps) {
  return (
    <div className="cg-brand-wrap">
      <a className="cg-brand" href="#garden" aria-label="Contribution Garden home">
        <span className="cg-brand-mark" aria-hidden="true">
          <Sprout size={18} strokeWidth={1.65} />
        </span>
        <span>
          <span className="cg-brand-name">Contribution Garden</span>
          <span className="cg-brand-caption">A living code archive</span>
        </span>
      </a>
      {onMenu ? (
        <button
          type="button"
          className="cg-mobile-menu-trigger"
          aria-label={menuOpen ? "Close garden menu" : "Open garden menu"}
          aria-expanded={menuOpen}
          onClick={onMenu}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      ) : null}
    </div>
  );
}

export interface GithubSearchProps {
  value?: string;
  initialValue?: string;
  loading?: boolean;
  onValueChange?: (value: string) => void;
  onSubmit?: (username: string) => void;
}

export function GithubSearch({
  value,
  initialValue = "",
  loading,
  onValueChange,
  onSubmit,
}: GithubSearchProps) {
  const [internalValue, setInternalValue] = useState(initialValue);
  const inputId = useId();
  const currentValue = value ?? internalValue;

  function updateValue(nextValue: string) {
    if (value === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = currentValue.trim().replace(/^@/, "");
    if (username && !loading) onSubmit?.(username);
  }

  return (
    <form className="cg-search" role="search" onSubmit={submit}>
      <label className="cg-sr-only" htmlFor={inputId}>
        Explore a GitHub garden
      </label>
      <Search size={15} aria-hidden="true" />
      <span className="cg-search-prefix" aria-hidden="true">
        @
      </span>
      <input
        id={inputId}
        value={currentValue}
        onChange={(event) => updateValue(event.target.value)}
        placeholder="Enter a GitHub username"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
      />
      <button type="submit" disabled={!currentValue.trim() || loading}>
        {loading ? <span className="cg-spinner" aria-hidden="true" /> : "Explore"}
        <span className="cg-sr-only"> {currentValue || "garden"}</span>
      </button>
    </form>
  );
}

export interface GardenTopNavigationProps extends GithubSearchProps {
  menuOpen?: boolean;
  onMenu?: () => void;
  onShare?: () => void;
  dataSource?: GitHubDataSource;
}

export function GardenTopNavigation({
  menuOpen,
  onMenu,
  onShare,
  dataSource,
  ...searchProps
}: GardenTopNavigationProps) {
  return (
    <header className="cg-topbar">
      <GardenBrand menuOpen={menuOpen} onMenu={onMenu} />
      <GithubSearch {...searchProps} />
      <div className="cg-top-actions">
        {dataSource ? (
          <div
            className={cx("cg-live-label", dataSource === "demo" && "is-demo")}
            title={
              dataSource === "github"
                ? "Loaded from GitHub through the private server connection"
                : "Using the built-in local demo dataset"
            }
          >
            <span aria-hidden="true" />
            {dataSource === "github" ? "Live GitHub" : "Demo garden"}
          </div>
        ) : null}
        <IconButton label="Share this garden" onClick={onShare}>
          <Share2 size={16} />
        </IconButton>
      </div>
    </header>
  );
}

export interface ProfileMetricsPanelProps {
  profile: GardenProfile;
  metrics: GardenMetric[];
  ecosystemHealth?: number;
  onOpenProfile?: () => void;
  compact?: boolean;
}

export function ProfileMetricsPanel({
  profile,
  metrics,
  ecosystemHealth = 86,
  onOpenProfile,
  compact,
}: ProfileMetricsPanelProps) {
  const displayMetrics = compact ? metrics.slice(0, 4) : metrics.slice(0, 6);
  const initials = (profile.name || profile.login)
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <section
      className={cx("cg-panel", "cg-profile-panel", compact && "is-compact")}
      aria-label={`${profile.login}'s garden profile`}
    >
      <div className="cg-panel-rule">
        <span>Garden steward</span>
        <span>№ {profile.joinedYear ?? "—"}</span>
      </div>

      <div className="cg-profile-header">
        <div className="cg-avatar" aria-hidden="true">
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatarUrl} alt="" />
          ) : (
            <span>{initials}</span>
          )}
          <span className="cg-avatar-status" />
        </div>
        <div className="cg-profile-heading">
          <h1>{profile.name || profile.login}</h1>
          <p>@{profile.login}</p>
        </div>
      </div>

      {profile.bio ? <p className="cg-profile-bio">{profile.bio}</p> : null}

      <div className="cg-profile-meta">
        {profile.location ? (
          <span>
            <MapPin size={12} /> {profile.location}
          </span>
        ) : null}
        {profile.joinedYear ? <span>Growing since {profile.joinedYear}</span> : null}
      </div>

      <div className="cg-health">
        <div className="cg-health-copy">
          <span>Ecosystem vitality</span>
          <strong>{Math.round(ecosystemHealth)}%</strong>
        </div>
        <div
          className="cg-health-track"
          role="meter"
          aria-label="Ecosystem vitality"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ecosystemHealth)}
        >
          <span style={{ width: `${Math.min(100, Math.max(0, ecosystemHealth))}%` }} />
        </div>
      </div>

      <dl className="cg-metric-grid">
        {displayMetrics.map((metric) => {
          const MetricIcon = metricIcons[metric.key];
          return (
            <div key={`${metric.key}-${metric.label}`} className="cg-metric">
              <dt>
                <MetricIcon size={13} strokeWidth={1.6} />
                {metric.label}
              </dt>
              <dd>{formatMetric(metric.value)}</dd>
              {metric.detail ? <span>{metric.detail}</span> : null}
            </div>
          );
        })}
      </dl>

      <button className="cg-profile-link" type="button" onClick={onOpenProfile}>
        <Code2 size={14} />
        View field record
        <ExternalLink size={12} />
      </button>
    </section>
  );
}

export interface SpecimenCardProps {
  entity?: GardenEntity | null;
  onClose?: () => void;
  compact?: boolean;
}

export function SpecimenCard({ entity, onClose, compact }: SpecimenCardProps) {
  const reduceMotion = useReducedMotion();

  if (!entity) {
    return (
      <aside className="cg-specimen-empty" aria-label="Garden inspection hint">
        <span className="cg-reticle" aria-hidden="true">
          <LocateFixed size={17} />
        </span>
        <div>
          <span>Field study</span>
          <p>Select a plant or creature to reveal the code story it carries.</p>
        </div>
      </aside>
    );
  }

  const EntityIcon = entityIcons[entity.kind];
  const accent = entity.accent || "#d7e5a4";
  const style = { "--entity-accent": accent } as CSSProperties;

  return (
    <motion.aside
      key={entity.id}
      className={cx("cg-specimen", compact && "is-compact")}
      style={style}
      aria-label={`Selected ${entity.kind}: ${entity.title}`}
      initial={reduceMotion ? false : { opacity: 0, x: 18, filter: "blur(4px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      exit={reduceMotion ? undefined : { opacity: 0, x: 12 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="cg-specimen-topline">
        <span>Specimen record · {entity.id.slice(0, 8)}</span>
        {onClose ? (
          <button type="button" aria-label="Close specimen record" onClick={onClose}>
            <X size={15} />
          </button>
        ) : null}
      </div>

      <div className="cg-specimen-icon" aria-hidden="true">
        <EntityIcon size={32} strokeWidth={1.25} />
        <span />
      </div>

      <div className="cg-specimen-title">
        <p>{entity.eyebrow || entity.kind}</p>
        <h2>{entity.title}</h2>
        {entity.subtitle ? <span>{entity.subtitle}</span> : null}
      </div>

      {entity.description ? (
        <p className="cg-specimen-description">{entity.description}</p>
      ) : null}

      <dl className="cg-facts">
        {entity.date ? (
          <div>
            <dt>Observed</dt>
            <dd>{entity.date}</dd>
          </div>
        ) : null}
        {entity.repository ? (
          <div>
            <dt>Repository</dt>
            <dd>{entity.repository}</dd>
          </div>
        ) : null}
        {entity.contributionCount !== undefined ? (
          <div>
            <dt>Activity</dt>
            <dd>{entity.contributionCount} contributions</dd>
          </div>
        ) : null}
        {entity.status ? (
          <div>
            <dt>Condition</dt>
            <dd className="cg-condition">
              <span /> {entity.status}
            </dd>
          </div>
        ) : null}
        {entity.facts?.map((fact) => (
          <div key={`${fact.label}-${fact.value}`}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>

      {entity.href ? (
        <a className="cg-specimen-link" href={entity.href} target="_blank" rel="noreferrer">
          Open on GitHub <ExternalLink size={13} />
        </a>
      ) : null}
    </motion.aside>
  );
}

export interface SeasonWeatherControlsProps {
  season: GardenSeason;
  weather: GardenWeather;
  onSeasonChange?: (season: GardenSeason) => void;
  onWeatherChange?: (weather: GardenWeather) => void;
}

export function SeasonWeatherControls({
  season,
  weather,
  onSeasonChange,
  onWeatherChange,
}: SeasonWeatherControlsProps) {
  const [seasonOpen, setSeasonOpen] = useState(false);
  const seasonWrapRef = useRef<HTMLDivElement>(null);
  const seasonTriggerRef = useRef<HTMLButtonElement>(null);
  const seasonMenuId = useId();
  const activeSeason = seasons.find((option) => option.value === season) ?? seasons[0];
  const activeWeather =
    weatherOptions.find((option) => option.value === weather) ?? weatherOptions[0];
  const WeatherIcon = activeWeather.icon;

  useEffect(() => {
    if (!seasonOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!seasonWrapRef.current?.contains(event.target as Node)) {
        setSeasonOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [seasonOpen]);

  return (
    <div
      className="cg-atmosphere-controls"
      role="group"
      aria-label="Garden atmosphere controls"
    >
      <div className="cg-select-wrap" ref={seasonWrapRef}>
        <button
          ref={seasonTriggerRef}
          type="button"
          className="cg-atmosphere-select"
          aria-expanded={seasonOpen}
          aria-haspopup="true"
          aria-controls={seasonMenuId}
          onClick={() => setSeasonOpen((open) => !open)}
        >
          <Leaf size={14} />
          <span>
            <small>Season</small>
            {activeSeason.label}
          </span>
          <ChevronDown size={13} />
        </button>
        <AnimatePresence>
          {seasonOpen ? (
            <motion.div
              id={seasonMenuId}
              className="cg-season-menu"
              aria-label="Select garden season"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSeasonOpen(false);
                  seasonTriggerRef.current?.focus();
                }
              }}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
            >
              {seasons.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={option.value === season}
                  onClick={() => {
                    onSeasonChange?.(option.value);
                    setSeasonOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === season ? <Check size={13} /> : null}
                </button>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="cg-weather-switch">
        <span className="cg-weather-current" title={`${activeWeather.label} weather`}>
          <WeatherIcon size={14} />
        </span>
        {weatherOptions.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              className={option.value === weather ? "is-active" : undefined}
              aria-label={`${option.label} weather`}
              aria-pressed={option.value === weather}
              title={option.label}
              onClick={() => onWeatherChange?.(option.value)}
            >
              <Icon size={14} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface GardenTimelineProps {
  timeline: TimelineState;
  onChange?: (value: number) => void;
  onStep?: (direction: -1 | 1) => void;
  onPlaybackToggle?: () => void;
  onSpeedChange?: (speed: 1 | 2 | 4) => void;
}

export function GardenTimeline({
  timeline,
  onChange,
  onStep,
  onPlaybackToggle,
  onSpeedChange,
}: GardenTimelineProps) {
  const progress =
    timeline.max === timeline.min
      ? 0
      : ((timeline.value - timeline.min) / (timeline.max - timeline.min)) * 100;
  const nextSpeed = timeline.speed === 1 ? 2 : timeline.speed === 2 ? 4 : 1;
  const rangeId = useId();

  return (
    <section className="cg-timeline" aria-label="Garden history timeline">
      <div className="cg-timeline-heading">
        <span>Growth archive</span>
        <div>
          <strong>{timeline.label}</strong>
          {timeline.detail ? <small>{timeline.detail}</small> : null}
        </div>
      </div>

      <div className="cg-playback">
        <IconButton
          label="Previous month"
          disabled={timeline.canStepBackward === false}
          onClick={() => onStep?.(-1)}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <button
          type="button"
          className="cg-play-button"
          aria-label={timeline.isPlaying ? "Pause garden history" : "Play garden history"}
          aria-pressed={timeline.isPlaying}
          onClick={onPlaybackToggle}
        >
          {timeline.isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <IconButton
          label="Next month"
          disabled={timeline.canStepForward === false}
          onClick={() => onStep?.(1)}
        >
          <ChevronRight size={16} />
        </IconButton>
      </div>

      <div className="cg-range-wrap">
        <label className="cg-sr-only" htmlFor={rangeId}>
          Garden history position: {timeline.label}
        </label>
        <input
          id={rangeId}
          className="cg-range"
          type="range"
          min={timeline.min}
          max={timeline.max}
          value={timeline.value}
          style={{ "--timeline-progress": `${progress}%` } as CSSProperties}
          onChange={(event) => onChange?.(Number(event.target.value))}
        />
        <div className="cg-range-labels" aria-hidden="true">
          <span>{timeline.startLabel || timeline.min}</span>
          <span>{timeline.endLabel || timeline.max}</span>
        </div>
      </div>

      <button
        type="button"
        className="cg-speed"
        aria-label={`Playback speed ${timeline.speed ?? 1} times; change to ${nextSpeed} times`}
        onClick={() => onSpeedChange?.(nextSpeed)}
      >
        <FastForward size={13} /> {timeline.speed ?? 1}×
      </button>
    </section>
  );
}

export interface ExperienceControlsProps {
  ambientSound?: boolean;
  cinematic?: boolean;
  walking?: boolean;
  onAmbientSoundToggle?: () => void;
  onCinematicToggle?: () => void;
  onWalkingChange?: (active: boolean) => void;
  onScreenshot?: () => void;
  onResetView?: () => void;
}

export function ExperienceControls({
  ambientSound,
  cinematic,
  walking,
  onAmbientSoundToggle,
  onCinematicToggle,
  onWalkingChange,
  onScreenshot,
  onResetView,
}: ExperienceControlsProps) {
  return (
    <div
      className="cg-experience-controls"
      role="group"
      aria-label="Garden experience controls"
    >
      <IconButton label="Reset garden view" onClick={onResetView}>
        <LocateFixed size={16} />
      </IconButton>
      <span className="cg-control-divider" aria-hidden="true" />
      <button
        type="button"
        className={cx("cg-enter-garden", walking && "is-active")}
        aria-pressed={walking}
        onClick={() => onWalkingChange?.(!walking)}
      >
        <Footprints size={15} />
        <span>{walking ? "Exit walk" : "Walk in 3D"}</span>
      </button>
      <IconButton
        label={cinematic ? "Stop cinematic flight" : "Start cinematic flight"}
        active={cinematic}
        disabled={walking}
        onClick={onCinematicToggle}
      >
        <Maximize2 size={16} />
      </IconButton>
      <IconButton label="Take a garden photograph" onClick={onScreenshot}>
        <Camera size={16} />
      </IconButton>
      <IconButton
        label={ambientSound ? "Mute garden ambience" : "Play garden ambience"}
        active={ambientSound}
        onClick={onAmbientSoundToggle}
      >
        {ambientSound ? <Volume2 size={16} /> : <VolumeX size={16} />}
      </IconButton>
    </div>
  );
}

export interface WalkthroughHUDProps {
  active?: boolean;
  onExit?: () => void;
  onDirectionChange?: (
    direction: GardenWalkDirection,
    active: boolean,
  ) => void;
}

export function WalkthroughHUD({
  active,
  onExit,
  onDirectionChange,
}: WalkthroughHUDProps) {
  if (!active) return null;

  const directionButton = (
    direction: GardenWalkDirection,
    label: string,
    symbol: string,
    shortcuts: string,
  ) => (
    <button
      type="button"
      className={`cg-walk-${direction}`}
      aria-label={label}
      aria-keyshortcuts={shortcuts}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onDirectionChange?.(direction, true);
      }}
      onPointerUp={(event) => {
        onDirectionChange?.(direction, false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => onDirectionChange?.(direction, false)}
      onLostPointerCapture={() => onDirectionChange?.(direction, false)}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          onDirectionChange?.(direction, true);
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          onDirectionChange?.(direction, false);
        }
      }}
      onBlur={() => onDirectionChange?.(direction, false)}
    >
      {symbol}
    </button>
  );

  return (
    <div
      className="cg-walkthrough-hud"
      role="group"
      aria-label="First-person garden controls"
    >
      <div className="cg-walkthrough-crosshair" aria-hidden="true" />
      <div className="cg-walkthrough-copy">
        <Footprints size={15} />
        <span>
          <strong>Walking the garden</strong>
          <small>WASD or arrows to move · drag to look · Shift to move faster</small>
        </span>
      </div>
      <button
        id="garden-walk-exit"
        type="button"
        className="cg-walkthrough-exit"
        onClick={onExit}
      >
        <X size={15} />
        <span>Exit walk</span>
      </button>
      <div
        className="cg-walk-pad"
        role="group"
        aria-label="Walk direction controls"
      >
        {directionButton("forward", "Walk forward", "↑", "W ArrowUp")}
        {directionButton("left", "Walk left", "←", "A ArrowLeft")}
        {directionButton("backward", "Walk backward", "↓", "S ArrowDown")}
        {directionButton("right", "Walk right", "→", "D ArrowRight")}
      </div>
      <p className="cg-sr-only" role="status">
        Walk mode active. Use W A S D or arrow keys to move, drag to look, and
        Escape to exit.
      </p>
    </div>
  );
}

export interface AchievementRibbonProps {
  achievements: GardenAchievement[];
  onOpen?: () => void;
}

export function AchievementRibbon({
  achievements,
  onOpen,
}: AchievementRibbonProps) {
  const unlocked = achievements.filter((achievement) => achievement.unlocked);
  const latest = unlocked.at(-1) ?? achievements[0];

  if (!latest) return null;

  return (
    <button className="cg-achievement-ribbon" type="button" onClick={onOpen}>
      <span className="cg-achievement-seal" aria-hidden="true">
        <Award size={16} />
      </span>
      <span className="cg-achievement-copy">
        <small>{latest.unlocked ? "Latest phenomenon" : "Next phenomenon"}</small>
        <strong>{latest.title}</strong>
      </span>
      <span className="cg-achievement-count">
        {unlocked.length}/{achievements.length}
      </span>
      <ChevronRight size={14} />
    </button>
  );
}

interface MobileSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

function MobileSheet({ open, title, onClose, children }: MobileSheetProps) {
  const reduceMotion = useReducedMotion();
  const sheetRef = useRef<HTMLElement>(null);

  // Dialog semantics: move focus in, keep Tab cycling inside, support
  // Escape, and restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    sheetRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...sheet.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) {
        event.preventDefault();
        sheet.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="cg-mobile-sheet-layer">
          <motion.button
            type="button"
            className="cg-mobile-sheet-backdrop"
            aria-label={`Close ${title}`}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.section
            ref={sheetRef}
            className="cg-mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={reduceMotion ? false : { y: "100%" }}
            animate={{ y: 0 }}
            exit={reduceMotion ? undefined : { y: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 38 }}
          >
            <div className="cg-sheet-handle" aria-hidden="true" />
            <header>
              <p>{title}</p>
              <button type="button" aria-label={`Close ${title}`} onClick={onClose}>
                <X size={17} />
              </button>
            </header>
            <div className="cg-sheet-body">{children}</div>
          </motion.section>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

export interface AchievementCollectionProps {
  achievements: GardenAchievement[];
}

export function AchievementCollection({ achievements }: AchievementCollectionProps) {
  return (
    <div className="cg-achievement-list">
      {achievements.map((achievement, index) => (
        <article
          key={achievement.id}
          className={cx(
            "cg-achievement-item",
            achievement.unlocked && "is-unlocked",
            achievement.rarity && `is-${achievement.rarity}`,
          )}
        >
          <span className="cg-achievement-number">{String(index + 1).padStart(2, "0")}</span>
          <span className="cg-achievement-glyph" aria-hidden="true">
            {achievement.rarity === "mythic" ? (
              <MoonStar size={20} />
            ) : achievement.rarity === "legendary" ? (
              <Trees size={20} />
            ) : (
              <Award size={19} />
            )}
          </span>
          <span>
            <small>{achievement.rarity || "field note"}</small>
            <strong>{achievement.title}</strong>
            {achievement.description ? <p>{achievement.description}</p> : null}
            {!achievement.unlocked && achievement.progress !== undefined ? (
              <span className="cg-achievement-progress">
                <i style={{ width: `${Math.max(0, Math.min(100, achievement.progress))}%` }} />
              </span>
            ) : null}
          </span>
          {achievement.unlocked ? <Check size={15} className="cg-achievement-check" /> : null}
        </article>
      ))}
    </div>
  );
}

type MobilePanel = "profile" | "specimen" | "achievements" | null;

export function GardenUI({
  profile,
  metrics,
  timeline,
  achievements = [],
  selectedEntity,
  season = "auto",
  weather = "sunny",
  searchValue,
  ecosystemHealth,
  ambientSound,
  cinematic,
  walking,
  isSearching,
  className,
  children,
  onSearchValueChange,
  onSearch,
  onSeasonChange,
  onWeatherChange,
  onTimelineChange,
  onTimelineStep,
  onPlaybackToggle,
  onSpeedChange,
  onAmbientSoundToggle,
  onCinematicToggle,
  onWalkingChange,
  onWalkDirectionChange,
  onScreenshot,
  onShare,
  onResetView,
  onEntityClose,
  onOpenProfile,
  dataSource,
  presentation = "field",
}: GardenUIProps) {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const unlockedCount = useMemo(
    () => achievements.filter((achievement) => achievement.unlocked).length,
    [achievements],
  );

  const changeWalking = (active: boolean) => {
    if (active) {
      setMobilePanel(null);
      setMobileMenuOpen(false);
    }
    onWalkingChange?.(active);
  };

  return (
    <div
      id="garden"
      className={cx("garden-ui", className)}
      data-cinematic={cinematic ? "true" : "false"}
      data-walking={walking ? "true" : "false"}
      data-presentation={presentation}
    >
      {children ? <div className="cg-world-slot">{children}</div> : null}
      <WalkthroughHUD
        active={walking}
        onExit={() => changeWalking(false)}
        onDirectionChange={onWalkDirectionChange}
      />
      <a
        className="cg-skip-link"
        href={walking ? "#garden-walk-exit" : "#garden-timeline"}
      >
        {walking ? "Exit walk mode" : "Skip to garden timeline"}
      </a>

      <GardenTopNavigation
        value={searchValue}
        loading={isSearching}
        onValueChange={onSearchValueChange}
        onSubmit={onSearch}
        onShare={onShare}
        dataSource={dataSource}
        menuOpen={mobileMenuOpen}
        onMenu={() => setMobileMenuOpen((open) => !open)}
      />

      <div className="cg-atmosphere-position">
        <SeasonWeatherControls
          season={season}
          weather={weather}
          onSeasonChange={onSeasonChange}
          onWeatherChange={onWeatherChange}
        />
      </div>

      {presentation === "field" ? (
        <div className="cg-profile-position">
          <ProfileMetricsPanel
            profile={profile}
            metrics={metrics}
            ecosystemHealth={ecosystemHealth}
            onOpenProfile={onOpenProfile}
          />
        </div>
      ) : null}

      {presentation === "field" || selectedEntity ? (
        <div className="cg-specimen-position">
          <AnimatePresence mode="wait">
            <SpecimenCard
              key={selectedEntity?.id ?? "empty"}
              entity={selectedEntity}
              onClose={onEntityClose}
            />
          </AnimatePresence>
        </div>
      ) : null}

      {presentation === "field" && achievements.length ? (
        <div className="cg-ribbon-position">
          <AchievementRibbon
            achievements={achievements}
            onOpen={() => setMobilePanel("achievements")}
          />
        </div>
      ) : null}

      <div className="cg-experience-position">
        <ExperienceControls
          ambientSound={ambientSound}
          cinematic={cinematic}
          walking={walking}
          onAmbientSoundToggle={onAmbientSoundToggle}
          onCinematicToggle={onCinematicToggle}
          onWalkingChange={changeWalking}
          onScreenshot={onScreenshot}
          onResetView={onResetView}
        />
      </div>

      <div className="cg-timeline-position" id="garden-timeline">
        <GardenTimeline
          timeline={timeline}
          onChange={onTimelineChange}
          onStep={onTimelineStep}
          onPlaybackToggle={onPlaybackToggle}
          onSpeedChange={onSpeedChange}
        />
      </div>

      <nav className="cg-mobile-dock" aria-label="Garden panels">
        <button type="button" onClick={() => setMobilePanel("profile")}>
          <UserRound size={17} />
          <span>Steward</span>
        </button>
        <button
          type="button"
          className={selectedEntity ? "has-update" : undefined}
          onClick={() => setMobilePanel("specimen")}
        >
          <LocateFixed size={17} />
          <span>Specimen</span>
        </button>
        <button type="button" onClick={() => setMobilePanel("achievements")}>
          <Award size={17} />
          <span>Events</span>
          {unlockedCount ? <i>{unlockedCount}</i> : null}
        </button>
        <button type="button" onClick={() => changeWalking(true)}>
          <Footprints size={17} />
          <span>Walk</span>
        </button>
      </nav>

      <AnimatePresence>
        {mobileMenuOpen ? (
          <motion.div
            className="cg-mobile-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <GithubSearch
              value={searchValue}
              loading={isSearching}
              onValueChange={onSearchValueChange}
              onSubmit={(username) => {
                onSearch?.(username);
                setMobileMenuOpen(false);
              }}
            />
            <SeasonWeatherControls
              season={season}
              weather={weather}
              onSeasonChange={onSeasonChange}
              onWeatherChange={onWeatherChange}
            />
            <ExperienceControls
              ambientSound={ambientSound}
              cinematic={cinematic}
              walking={walking}
              onAmbientSoundToggle={onAmbientSoundToggle}
              onCinematicToggle={onCinematicToggle}
              onWalkingChange={changeWalking}
              onScreenshot={onScreenshot}
              onResetView={onResetView}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <MobileSheet
        open={mobilePanel === "profile"}
        title="Garden steward"
        onClose={() => setMobilePanel(null)}
      >
        <ProfileMetricsPanel
          profile={profile}
          metrics={metrics}
          ecosystemHealth={ecosystemHealth}
          onOpenProfile={onOpenProfile}
          compact
        />
      </MobileSheet>

      <MobileSheet
        open={mobilePanel === "specimen"}
        title="Specimen record"
        onClose={() => setMobilePanel(null)}
      >
        <SpecimenCard entity={selectedEntity} compact onClose={() => setMobilePanel(null)} />
      </MobileSheet>

      <MobileSheet
        open={mobilePanel === "achievements"}
        title="Natural phenomena"
        onClose={() => setMobilePanel(null)}
      >
        {achievements.length ? (
          <AchievementCollection achievements={achievements} />
        ) : (
          <p className="cg-empty-copy">New phenomena emerge as this garden grows.</p>
        )}
      </MobileSheet>

      {presentation === "field" ? (
        <>
          <div className="cg-corner-coordinate" aria-hidden="true">
            <span>CG / {profile.login.toUpperCase()}</span>
            <span>FIELD VIEW 01</span>
          </div>
          <div className="cg-ambient-indicator" aria-hidden="true">
            <Headphones size={12} /> Ambient sound {ambientSound ? "on" : "off"}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default GardenUI;
