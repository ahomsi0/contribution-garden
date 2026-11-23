const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

export function formatUpdated(iso: string, now: Date = new Date()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "update time unknown";
  const age = Math.max(0, now.getTime() - parsed);
  if (age < 5 * MINUTE) return "updated just now";
  if (age < HOUR) return `updated ${plural(Math.floor(age / MINUTE), "minute")} ago`;
  if (age < DAY) return `updated ${plural(Math.floor(age / HOUR), "hour")} ago`;
  return `updated ${plural(Math.floor(age / DAY), "day")} ago`;
}

export function isStale(iso: string, now: Date = new Date()): boolean {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return true;
  return now.getTime() - parsed > 48 * HOUR;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
