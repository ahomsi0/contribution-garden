const CALENDAR_FIELDS = /* GraphQL */ `
  totalCommitContributions
  totalIssueContributions
  totalPullRequestContributions
  totalPullRequestReviewContributions
  restrictedContributionsCount
  contributionCalendar {
    totalContributions
    weeks {
      contributionDays {
        date
        weekday
        contributionCount
        contributionLevel
        color
      }
    }
  }
`;

const REPOSITORY_FIELDS = /* GraphQL */ `
  commitContributionsByRepository(maxRepositories: 25) {
    repository { nameWithOwner isPrivate }
    contributions(first: 100) {
      nodes { occurredAt commitCount }
    }
  }
`;

/** Years at or after (currentYear - this) include per-repository commit detail. */
const REPOSITORY_DETAIL_YEARS = 1;

export function yearRange(year: number, now: Date): { from: string; to: string } {
  const from = `${year}-01-01T00:00:00.000Z`;
  const to =
    year === now.getUTCFullYear()
      ? now.toISOString()
      : new Date(Date.UTC(year + 1, 0, 1) - 1_000).toISOString();
  return { from, to };
}

export function contributionHistoryQuery(years: readonly number[], now: Date): string {
  const currentYear = now.getUTCFullYear();
  const selections = years
    .map((year) => {
      const { from, to } = yearRange(year, now);
      const withRepositories = year >= currentYear - REPOSITORY_DETAIL_YEARS;
      return `
        y${year}: contributionsCollection(from: "${from}", to: "${to}") {
          ${CALENDAR_FIELDS}
          ${withRepositories ? REPOSITORY_FIELDS : ""}
        }
      `;
    })
    .join("\n");

  return `
    query ContributionGardenHistory($login: String!) {
      user(login: $login) {
        ${selections}
      }
    }
  `;
}
