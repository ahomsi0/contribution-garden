import {
  contributionLevelFromCount,
  deriveCalendarMetrics,
  type ContributionDay,
  type GitHubGardenData,
  type GitHubLanguage,
  type GitHubRepository,
} from "./github-types";

export const DEFAULT_DEMO_USERNAME = "garden-caretaker";

const DAY_IN_MS = 86_400_000;
const LEVEL_COLORS = ["#dfe9dc", "#a9d59d", "#68b978", "#358b58", "#17623f"];

const REPOSITORY_NAMES = [
  "canopy",
  "moss-ui",
  "river-runtime",
  "fern-kit",
  "firefly",
  "seedling",
  "wildflower-api",
  "tiny-orchard",
  "night-bloom",
  "weather-vane",
  "forest-notes",
  "stone-path",
] as const;

const LANGUAGE_PALETTE = [
  { name: "TypeScript", color: "#3178c6", weight: 34 },
  { name: "JavaScript", color: "#f1e05a", weight: 21 },
  { name: "Rust", color: "#dea584", weight: 15 },
  { name: "Python", color: "#3572A5", weight: 13 },
  { name: "CSS", color: "#663399", weight: 10 },
  { name: "GLSL", color: "#5686a5", weight: 7 },
] as const;

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function unit(value: string): number {
  let state = hashString(value) + 0x6d2b79f5;
  state = Math.imul(state ^ (state >>> 15), state | 1);
  state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
  return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
}

function titleCaseLogin(login: string): string {
  return login
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function demoAvatar(login: string, seed: number): string {
  const initials = titleCaseLogin(login)
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const palettes = [
    ["#173f35", "#8fcf9b"],
    ["#233a53", "#9bc5e8"],
    ["#4b3028", "#e7b58d"],
    ["#393054", "#c9b5ed"],
  ] as const;
  const [background, foreground] = palettes[seed % palettes.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" rx="80" fill="${background}"/><circle cx="118" cy="39" r="34" fill="${foreground}" opacity=".16"/><path d="M19 126c23-24 45-32 66-23 18 7 37 5 56-7v64H19z" fill="${foreground}" opacity=".2"/><text x="80" y="96" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="48" font-weight="700" fill="${foreground}">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_IN_MS);
}

function languageData(seed: number): GitHubLanguage[] {
  const totalBytes = 5_000_000 + (seed % 8_000_000);
  const adjusted = LANGUAGE_PALETTE.map((language, index) => ({
    ...language,
    adjustedWeight:
      language.weight * (0.84 + unit(`${seed}:language:${index}`) * 0.32),
  }));
  const totalWeight = adjusted.reduce(
    (sum, language) => sum + language.adjustedWeight,
    0,
  );

  return adjusted
    .map((language) => {
      const ratio = language.adjustedWeight / totalWeight;
      return {
        name: language.name,
        color: language.color,
        bytes: Math.round(totalBytes * ratio),
        percentage: Math.round(ratio * 1_000) / 10,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

function repositoryData(
  login: string,
  totalStars: number,
  now: Date,
  seed: number,
): GitHubRepository[] {
  const weights = REPOSITORY_NAMES.map((_, index) =>
    Math.max(1, REPOSITORY_NAMES.length - index + unit(`${seed}:repo:${index}`) * 4),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let assignedStars = 0;

  return REPOSITORY_NAMES.map((name, index) => {
    const stars =
      index === REPOSITORY_NAMES.length - 1
        ? Math.max(0, totalStars - assignedStars)
        : Math.floor((totalStars * weights[index]) / totalWeight);
    assignedStars += stars;
    const language = LANGUAGE_PALETTE[(seed + index * 3) % LANGUAGE_PALETTE.length];
    const updatedAt = new Date(
      now.getTime() - (index * 11 + (seed % 9)) * DAY_IN_MS,
    ).toISOString();

    return {
      name,
      nameWithOwner: `${login}/${name}`,
      url: `https://github.com/${login}/${name}`,
      description: [
        "A calm toolkit for growing expressive interfaces.",
        "Small experiments in motion, light, and procedural worlds.",
        "Developer tools shaped around focus and thoughtful defaults.",
        "An open-source corner for playful, nature-inspired software.",
      ][index % 4],
      stars,
      forks: Math.max(0, Math.floor(stars * (0.08 + unit(`${seed}:fork:${index}`) * 0.1))),
      primaryLanguage: language.name,
      primaryLanguageColor: language.color,
      updatedAt,
      isArchived: index === REPOSITORY_NAMES.length - 1 && seed % 3 === 0,
    };
  }).sort((a, b) => b.stars - a.stars);
}

function contributionCalendar(
  login: string,
  start: Date,
  end: Date,
  seed: number,
): ContributionDay[] {
  const calendar: ContributionDay[] = [];
  const totalDays = daysBetween(start, end);
  const firstWeekday = start.getUTCDay();
  const currentOrdinal = Math.floor(end.getTime() / DAY_IN_MS);
  const recentStreakLength = 10 + (seed % 14);
  const showcaseStreakLength = 38 + (seed % 37);
  const showcaseStreakEnd = currentOrdinal - 95 - (seed % 80);
  const showcaseStreakStart = showcaseStreakEnd - showcaseStreakLength + 1;

  for (let dayIndex = 0; dayIndex <= totalDays; dayIndex += 1) {
    const date = new Date(start.getTime() + dayIndex * DAY_IN_MS);
    const dateString = isoDate(date);
    const weekday = date.getUTCDay();
    const ordinal = Math.floor(date.getTime() / DAY_IN_MS);
    const dayOfYear = daysBetween(
      new Date(Date.UTC(date.getUTCFullYear(), 0, 1)),
      date,
    );
    const yearQuietStart =
      42 + (hashString(`${login}:${date.getUTCFullYear()}:quiet`) % 250);
    const isQuietPatch = dayOfYear >= yearQuietStart && dayOfYear < yearQuietStart + 9;
    const isRecentStreak = ordinal > currentOrdinal - recentStreakLength;
    const isShowcaseStreak =
      ordinal >= showcaseStreakStart && ordinal <= showcaseStreakEnd;
    const seasonalEnergy =
      0.5 +
      Math.sin((dayOfYear / 365) * Math.PI * 2 + (seed % 29) / 10) * 0.16;
    const weekdayEnergy = weekday === 0 || weekday === 6 ? -0.16 : 0.08;
    const activityRoll = unit(`${login}:${dateString}:active`);
    let isActive = activityRoll < seasonalEnergy + weekdayEnergy;

    if (isQuietPatch && !isRecentStreak) isActive = false;
    if (isRecentStreak || isShowcaseStreak) isActive = true;

    let count = 0;
    if (isActive) {
      const burst = unit(`${login}:${dateString}:burst`);
      const base = 1 + Math.floor(unit(`${login}:${dateString}:count`) * 7);
      count = base + (burst > 0.91 ? 7 + Math.floor(burst * 6) : 0);
    }

    const level = contributionLevelFromCount(count);
    const repositoryCount = count === 0 ? 0 : Math.min(3, 1 + Math.floor(count / 7));
    const firstRepository = hashString(`${login}:${dateString}:repo`) % REPOSITORY_NAMES.length;
    const repositories = Array.from({ length: repositoryCount }, (_, offset) => {
      const repository = REPOSITORY_NAMES[
        (firstRepository + offset * 5) % REPOSITORY_NAMES.length
      ];
      return `${login}/${repository}`;
    });

    calendar.push({
      date: dateString,
      count,
      level,
      weekday,
      week: Math.floor((dayIndex + firstWeekday) / 7),
      color: LEVEL_COLORS[level],
      repositories,
    });
  }

  return calendar;
}

export interface MockGitHubOptions {
  now?: Date;
  notice?: string;
}

/**
 * A username-seeded dataset used when no token is configured or GitHub is
 * unreachable. It deliberately contains quiet seasons, bursts, and long
 * streaks so every major garden mechanic can be explored locally.
 */
export function createMockGitHubData(
  requestedUsername: string = DEFAULT_DEMO_USERNAME,
  options: MockGitHubOptions = {},
): GitHubGardenData {
  const login = requestedUsername.trim().toLowerCase() || DEFAULT_DEMO_USERNAME;
  const now = options.now ? new Date(options.now) : new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const seed = hashString(login);
  const yearsOfHistory = 5 + (seed % 4);
  const firstYear = today.getUTCFullYear() - yearsOfHistory + 1;
  const calendarStart = new Date(Date.UTC(firstYear, 0, 1));
  const calendar = contributionCalendar(login, calendarStart, today, seed);
  const rollingYearStart = new Date(today);
  rollingYearStart.setUTCFullYear(rollingYearStart.getUTCFullYear() - 1);
  const rollingYearStartDate = isoDate(rollingYearStart);
  const rollingYearCalendar = calendar.filter(
    (day) => day.date >= rollingYearStartDate,
  );
  const totalContributions = rollingYearCalendar.reduce(
    (sum, day) => sum + day.count,
    0,
  );
  const commits = Math.round(totalContributions * (0.72 + (seed % 7) / 100));
  const pullRequests = Math.round(totalContributions * (0.075 + (seed % 4) / 100));
  const issues = Math.round(totalContributions * (0.045 + (seed % 3) / 100));
  const pullRequestReviews = Math.round(totalContributions * 0.065);
  const repositoryCount = 23 + (seed % 43);
  const totalStars = 180 + (seed % 1_640);
  const followers = 90 + (seed % 1_250);
  const following = 38 + (seed % 210);
  const repositories = repositoryData(login, totalStars, today, seed);
  const derived = deriveCalendarMetrics(calendar, today);
  const contributionYears = Array.from(
    { length: yearsOfHistory },
    (_, index) => today.getUTCFullYear() - index,
  );

  return {
    profile: {
      login,
      name: titleCaseLogin(login),
      bio: "Growing thoughtful open-source tools, one small commit at a time.",
      avatarUrl: demoAvatar(login, seed),
      url: `https://github.com/${login}`,
      location: "The eastern Mediterranean",
      company: "Independent",
      websiteUrl: null,
      joinedAt: `${firstYear}-01-01T00:00:00.000Z`,
      followers,
      following,
      repositories: repositoryCount,
      stars: totalStars,
    },
    metrics: {
      totalContributions,
      commits,
      pullRequests,
      issues,
      pullRequestReviews,
      repositories: repositoryCount,
      stars: totalStars,
      followers,
      ...derived,
    },
    calendar,
    languages: languageData(seed),
    repositories,
    contributionYears,
    source: "demo",
    fetchedAt: now.toISOString(),
    notice:
      options.notice ??
      "Showing a deterministic local demo. Add the server GitHub credentials to load live public data.",
  };
}
