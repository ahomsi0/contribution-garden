import { parseArgs } from "node:util";
import { COUNTRIES, findCountry } from "@/lib/rankings/countries";
import { INDEX_PATH, buildCountry, orderCountriesByStaleness } from "@/lib/rankings/build";
import { fetchUserHistory, searchCandidates } from "@/lib/rankings/github-source";
import { buildIndex, isRankingsIndex, type CountrySnapshot } from "@/lib/rankings/snapshot";
import { blobStore, directoryStore } from "@/lib/rankings/snapshot-store";

const CANDIDATE_LIMIT = 1_000;
const PUBLIC_LIMIT = 256;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      country: { type: "string" },
      limit: { type: "string" },
      out: { type: "string" },
    },
  });

  const token = process.env.RANKINGS_GITHUB_TOKEN?.trim();
  if (!token) {
    console.error("RANKINGS_GITHUB_TOKEN is not set.");
    return 1;
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

  for (const country of queue) {
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
