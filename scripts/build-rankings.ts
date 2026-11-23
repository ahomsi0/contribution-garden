import { parseArgs } from "node:util";
import { COUNTRIES, findCountry } from "@/lib/rankings/countries";
import { INDEX_PATH, buildCountry, orderCountriesByStaleness } from "@/lib/rankings/build";
import { fetchUserHistory, searchCandidates } from "@/lib/rankings/github-source";
import { buildIndex, isRankingsIndex, type CountrySnapshot } from "@/lib/rankings/snapshot";
import { blobStore, directoryStore } from "@/lib/rankings/snapshot-store";

const CANDIDATE_LIMIT = 1_000;
const PUBLIC_LIMIT = 256;

async function main(): Promise<number> {
  const startedAtMs = Date.now();
  const { values } = parseArgs({
    options: {
      country: { type: "string" },
      limit: { type: "string" },
      out: { type: "string" },
      "stop-starting-after": { type: "string" },
    },
  });

  const token = process.env.RANKINGS_GITHUB_TOKEN?.trim();
  if (!token) {
    console.error("RANKINGS_GITHUB_TOKEN is not set.");
    return 1;
  }

  if (values.limit !== undefined) {
    const parsed = Number(values.limit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.error("--limit must be a positive integer.");
      return 1;
    }
    if (!values.out) {
      console.error("--limit is only allowed with --out, so a partial board is never published.");
      return 1;
    }
  }
  let deadlineMinutes: number | null = null;
  if (values["stop-starting-after"] !== undefined) {
    deadlineMinutes = Number(values["stop-starting-after"]);
    if (!Number.isFinite(deadlineMinutes) || deadlineMinutes <= 0) {
      console.error("--stop-starting-after must be a positive number of minutes.");
      return 1;
    }
  }

  let store;
  if (values.out) {
    store = directoryStore(values.out);
  } else {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    const baseUrl = process.env.RANKINGS_BASE_URL?.trim();
    if (!blobToken || !baseUrl) {
      console.error("Set BLOB_READ_WRITE_TOKEN and RANKINGS_BASE_URL, or pass --out <dir>.");
      return 1;
    }
    store = blobStore({ token: blobToken, baseUrl });
  }

  const selected = values.country ? findCountry(values.country) : undefined;
  if (values.country && !selected) {
    console.error(`Unknown country "${values.country}".`);
    return 1;
  }
  const candidateLimit = values.limit ? Number(values.limit) : CANDIDATE_LIMIT;

  const previousRaw = await store.read(INDEX_PATH);
  let index = isRankingsIndex(previousRaw) ? previousRaw : null;
  const queue = selected ? [selected] : orderCountriesByStaleness(COUNTRIES, index);
  const order = COUNTRIES.map((country) => country.slug);
  let failures = 0;

  for (const [position, country] of queue.entries()) {
    if (deadlineMinutes !== null && (Date.now() - startedAtMs) / 60_000 >= deadlineMinutes) {
      console.log(`Deadline reached; leaving ${queue.length - position} countries for the next run.`);
      break;
    }
    const startedAt = Date.now();
    try {
      const snapshot: CountrySnapshot = await buildCountry(country, {
        store,
        now: new Date(),
        candidateLimit,
        publicLimit: PUBLIC_LIMIT,
        search: (aliases, limit) => searchCandidates(aliases, limit, { token }),
        fetchUser: (login, fromYear, now) => fetchUserHistory(login, fromYear, now, { token }),
        log: (message) => console.log(message),
      });
      index = buildIndex(index, [snapshot], order, new Date());
      await store.write(INDEX_PATH, index);
      console.log(
        `${country.slug}: ${snapshot.users.length} ranked in ${Math.round((Date.now() - startedAt) / 1000)}s`,
      );
    } catch (error) {
      failures += 1;
      console.error(`${country.slug}: failed — ${(error as Error).message}`);
      if ((error as { status?: unknown })?.status === 401) {
        console.error("GitHub rejected the token; stopping.");
        break;
      }
    }
  }

  return failures > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
