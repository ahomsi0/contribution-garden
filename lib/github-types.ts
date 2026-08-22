/**
 * The small, stable data contract shared by the GitHub route and the garden UI.
 * GitHub GraphQL response types intentionally stay inside the route so API
 * changes do not leak into the visual layer.
 */

export type GitHubDataSource = "github" | "demo";

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export interface GitHubProfile {
  login: string;
  name: string;
  bio: string;
  avatarUrl: string;
  url: string;
  location: string | null;
  company: string | null;
  websiteUrl: string | null;
  joinedAt: string;
  followers: number;
  following: number;
  repositories: number;
  stars: number;
}

export interface ContributionDay {
  /** ISO calendar date (YYYY-MM-DD). */
  date: string;
  count: number;
  /** Normalized GitHub contribution intensity, from dormant to most active. */
  level: ContributionLevel;
  /** Sunday is 0, matching GitHub's contribution calendar. */
  weekday: number;
  /** Zero-based visual column in the returned calendar. */
  week: number;
  color: string;
  /** Repositories with commit activity on this date, when GitHub exposes it. */
  repositories: string[];
}

export interface GitHubLanguage {
  name: string;
  color: string;
  bytes: number;
  percentage: number;
}

export interface GitHubRepository {
  name: string;
  nameWithOwner: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  primaryLanguage: string | null;
  primaryLanguageColor: string;
  updatedAt: string;
  isArchived: boolean;
}

export interface GitHubMetrics {
  /** Rolling one-year totals, matching GitHub's profile contribution summary. */
  totalContributions: number;
  commits: number;
  pullRequests: number;
  issues: number;
  pullRequestReviews: number;
  repositories: number;
  stars: number;
  followers: number;
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
  inactiveDays: number;
  recentContributions: number;
  averagePerActiveDay: number;
  lastContributionDate: string | null;
  mostActiveDay: { date: string; count: number } | null;
}

export interface GitHubGardenData {
  profile: GitHubProfile;
  metrics: GitHubMetrics;
  /** Daily contribution history, ordered oldest to newest. */
  calendar: ContributionDay[];
  languages: GitHubLanguage[];
  /** Most-starred repositories first. */
  repositories: GitHubRepository[];
  /** Newest year first, as presented by GitHub. */
  contributionYears: number[];
  source: GitHubDataSource;
  fetchedAt: string;
  /** Human-readable and safe to show in the local UI; never contains secrets. */
  notice?: string;
}

export interface DerivedCalendarMetrics {
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
  inactiveDays: number;
  recentContributions: number;
  averagePerActiveDay: number;
  lastContributionDate: string | null;
  mostActiveDay: { date: string; count: number } | null;
}

const DAY_IN_MS = 86_400_000;

export function contributionLevelFromCount(count: number): ContributionLevel {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

export function normalizeGitHubContributionLevel(
  level: string | null | undefined,
  count: number,
): ContributionLevel {
  switch (level) {
    case "FIRST_QUARTILE":
      return 1;
    case "SECOND_QUARTILE":
      return 2;
    case "THIRD_QUARTILE":
      return 3;
    case "FOURTH_QUARTILE":
      return 4;
    case "NONE":
      return 0;
    default:
      return contributionLevelFromCount(count);
  }
}

function dateOrdinal(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_IN_MS);
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Derive streak and activity facts from any complete daily calendar. An empty
 * current day does not end a streak until the day has passed.
 */
export function deriveCalendarMetrics(
  calendar: readonly ContributionDay[],
  now: Date = new Date(),
): DerivedCalendarMetrics {
  if (calendar.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      activeDays: 0,
      inactiveDays: 0,
      recentContributions: 0,
      averagePerActiveDay: 0,
      lastContributionDate: null,
      mostActiveDay: null,
    };
  }

  const ordered = [...calendar].sort((a, b) => a.date.localeCompare(b.date));
  const contributionByDay = new Map(
    ordered.map((day) => [dateOrdinal(day.date), day.count]),
  );
  const today = utcDateString(now);
  const todayOrdinal = dateOrdinal(today);

  let activeDays = 0;
  let totalOnActiveDays = 0;
  let longestStreak = 0;
  let runningStreak = 0;
  let previousActiveOrdinal: number | null = null;
  let lastContributionDate: string | null = null;
  let mostActiveDay: { date: string; count: number } | null = null;
  let recentContributions = 0;

  for (const day of ordered) {
    const ordinal = dateOrdinal(day.date);

    if (ordinal >= todayOrdinal - 29 && ordinal <= todayOrdinal) {
      recentContributions += day.count;
    }

    if (day.count <= 0) {
      continue;
    }

    activeDays += 1;
    totalOnActiveDays += day.count;
    lastContributionDate = day.date;

    if (!mostActiveDay || day.count > mostActiveDay.count) {
      mostActiveDay = { date: day.date, count: day.count };
    }

    runningStreak =
      previousActiveOrdinal !== null && ordinal === previousActiveOrdinal + 1
        ? runningStreak + 1
        : 1;
    longestStreak = Math.max(longestStreak, runningStreak);
    previousActiveOrdinal = ordinal;
  }

  let streakCursor = todayOrdinal;
  if ((contributionByDay.get(streakCursor) ?? 0) === 0) {
    streakCursor -= 1;
  }

  let currentStreak = 0;
  while ((contributionByDay.get(streakCursor) ?? 0) > 0) {
    currentStreak += 1;
    streakCursor -= 1;
  }

  return {
    currentStreak,
    longestStreak,
    activeDays,
    inactiveDays: Math.max(0, ordered.length - activeDays),
    recentContributions,
    averagePerActiveDay:
      activeDays === 0
        ? 0
        : Math.round((totalOnActiveDays / activeDays) * 10) / 10,
    lastContributionDate,
    mostActiveDay,
  };
}
