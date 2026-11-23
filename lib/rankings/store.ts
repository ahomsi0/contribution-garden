import { logger } from "@/lib/logger";
import {
  isCountrySnapshot,
  isRankingsIndex,
  type CountrySnapshot,
  type RankingsIndex,
} from "./snapshot";

const TTL_MS = 10 * 60 * 1_000;
const ERROR_TTL_MS = 30 * 1_000;
const FETCH_TIMEOUT_MS = 5_000;
const cache = new Map<string, { value: unknown; expires: number }>();
const lastGood = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown | null>>();

export function clearRankingsCache() {
  cache.clear();
  lastGood.clear();
  inflight.clear();
}

async function fetchJson(url: string, pathname: string): Promise<unknown | null> {
  let value: unknown = null;
  let ttl = TTL_MS;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.ok) {
      value = await response.json();
      lastGood.set(url, value);
    } else if (response.status !== 404) {
      logger.warn("rankings_read_failed", { pathname, status: response.status });
      ttl = ERROR_TTL_MS;
    }
  } catch (error) {
    logger.warn("rankings_read_error", { pathname, message: (error as Error).message });
    ttl = ERROR_TTL_MS;
  }
  if (ttl === ERROR_TTL_MS && lastGood.has(url)) {
    // Keep serving the last good copy and retry again after the short TTL.
    value = lastGood.get(url);
  } else if (ttl === TTL_MS && value === null) {
    lastGood.delete(url);
  }
  cache.set(url, { value, expires: Date.now() + ttl });
  return value;
}

async function readJson(pathname: string): Promise<unknown | null> {
  const base = process.env.RANKINGS_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return null;
  const url = `${base}/${pathname}`;
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;

  let pending = inflight.get(url);
  if (!pending) {
    pending = fetchJson(url, pathname).finally(() => inflight.delete(url));
    inflight.set(url, pending);
  }
  return pending;
}

export async function getRankingsIndex(): Promise<RankingsIndex | null> {
  const value = await readJson("rankings/index.json");
  return isRankingsIndex(value) ? value : null;
}

export async function getCountrySnapshot(slug: string): Promise<CountrySnapshot | null> {
  const value = await readJson(`rankings/${slug}.json`);
  return isCountrySnapshot(value) ? value : null;
}
