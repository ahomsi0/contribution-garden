import { logger } from "@/lib/logger";
import {
  isCountrySnapshot,
  isRankingsIndex,
  type CountrySnapshot,
  type RankingsIndex,
} from "./snapshot";

const TTL_MS = 10 * 60 * 1_000;
const cache = new Map<string, { value: unknown; expires: number }>();

export function clearRankingsCache() {
  cache.clear();
}

async function readJson(pathname: string): Promise<unknown | null> {
  const base = process.env.RANKINGS_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return null;
  const url = `${base}/${pathname}`;
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;

  let value: unknown = null;
  try {
    const response = await fetch(url);
    if (response.ok) value = await response.json();
    else if (response.status !== 404) {
      logger.warn("rankings_read_failed", { pathname, status: response.status });
    }
  } catch (error) {
    logger.warn("rankings_read_error", { pathname, message: (error as Error).message });
  }
  cache.set(url, { value, expires: Date.now() + TTL_MS });
  return value;
}

export async function getRankingsIndex(): Promise<RankingsIndex | null> {
  const value = await readJson("rankings/index.json");
  return isRankingsIndex(value) ? value : null;
}

export async function getCountrySnapshot(slug: string): Promise<CountrySnapshot | null> {
  const value = await readJson(`rankings/${slug}.json`);
  return isCountrySnapshot(value) ? value : null;
}
