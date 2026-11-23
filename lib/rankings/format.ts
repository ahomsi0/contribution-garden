const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

export function formatUpdated(iso: string, now: Date = new Date()): string {
  const age = Math.max(0, now.getTime() - Date.parse(iso));
  if (age < 5 * MINUTE) return "updated just now";
  if (age < HOUR) return `updated ${plural(Math.floor(age / MINUTE), "minute")} ago`;
  if (age < DAY) return `updated ${plural(Math.floor(age / HOUR), "hour")} ago`;
  return `updated ${plural(Math.floor(age / DAY), "day")} ago`;
}

export function isStale(iso: string, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(iso) > 48 * HOUR;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
