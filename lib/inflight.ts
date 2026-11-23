/**
 * Shares one in-flight promise per key across concurrent callers, but never
 * lets a stuck promise block later callers: entries older than maxAgeMs are
 * replaced, and every waiter gives up after maxAgeMs.
 */
export function createInflight<T>(maxAgeMs: number, now: () => number = Date.now) {
  const entries = new Map<string, { promise: Promise<T>; startedAt: number }>();

  function run(key: string, start: () => Promise<T>): Promise<T> {
    let entry = entries.get(key);
    if (!entry || now() - entry.startedAt >= maxAgeMs) {
      const created = { promise: start(), startedAt: now() };
      const release = () => {
        if (entries.get(key) === created) entries.delete(key);
      };
      created.promise.then(release, release);
      entries.set(key, created);
      entry = created;
    }

    const current = entry;
    const remaining = Math.max(0, maxAgeMs - (now() - current.startedAt));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (entries.get(key) === current) entries.delete(key);
        reject(new Error("in-flight request timed out"));
      }, remaining);
    });
    return Promise.race([current.promise, timeout]).finally(() => clearTimeout(timer));
  }

  return {
    run,
    size: () => entries.size,
    clear: () => entries.clear(),
  };
}
