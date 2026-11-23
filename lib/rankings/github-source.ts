export interface SearchUser {
  id: number;
  login: string;
}

export interface SearchDeps {
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const SEARCH_URL = "https://api.github.com/search/users";
const SEARCH_PAGE_SIZE = 100;
const SEARCH_RESULT_CAP = 1_000;
/** 30 search requests per minute → one every 2 s, plus a margin. */
export const SEARCH_THROTTLE_MS = 2_100;

export const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function searchAlias(
  alias: string,
  maxResults: number,
  deps: Required<SearchDeps>,
  throttle: () => Promise<void>,
): Promise<SearchUser[]> {
  const results: SearchUser[] = [];
  const pages = Math.ceil(Math.min(maxResults, SEARCH_RESULT_CAP) / SEARCH_PAGE_SIZE);
  for (let page = 1; page <= pages; page += 1) {
    await throttle();
    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", `location:"${alias}" followers:>10 type:user`);
    url.searchParams.set("sort", "followers");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", String(SEARCH_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    const response = await deps.fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${deps.token}`,
        "User-Agent": "Contribution-Garden-Rankings",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub search failed with status ${response.status} for "${alias}".`);
    }
    const body = (await response.json()) as { items?: Array<{ id: number; login: string }> };
    const items = body.items ?? [];
    for (const item of items) results.push({ id: item.id, login: item.login });
    if (items.length < SEARCH_PAGE_SIZE) break;
  }
  return results;
}

export async function searchCandidates(
  aliases: readonly string[],
  limit: number,
  deps: SearchDeps,
): Promise<SearchUser[]> {
  const resolved: Required<SearchDeps> = {
    token: deps.token,
    fetchImpl: deps.fetchImpl ?? fetch,
    sleep: deps.sleep ?? defaultSleep,
  };
  let first = true;
  const throttle = async () => {
    if (!first) await resolved.sleep(SEARCH_THROTTLE_MS);
    first = false;
  };

  const lists: SearchUser[][] = [];
  for (const alias of aliases) {
    lists.push(await searchAlias(alias, limit, resolved, throttle));
  }

  const seen = new Set<number>();
  const merged: SearchUser[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let position = 0; position < longest && merged.length < limit; position += 1) {
    for (const list of lists) {
      const user = list[position];
      if (!user || seen.has(user.id)) continue;
      seen.add(user.id);
      merged.push(user);
      if (merged.length >= limit) break;
    }
  }
  return merged;
}
