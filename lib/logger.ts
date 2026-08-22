/**
 * Minimal structured logger for server-side routes.
 *
 * Emits single-line JSON so Cloudflare Worker logs (or any log drain) can be
 * parsed and queried. Secrets must never be passed to these helpers; callers
 * log identifiers, statuses, and durations only.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minimumLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (
    configured === "debug" ||
    configured === "info" ||
    configured === "warn" ||
    configured === "error"
  ) {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

export interface LogContext {
  [key: string]: string | number | boolean | null | undefined;
}

function write(level: LogLevel, event: string, context?: LogContext) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimumLevel()]) return;

  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    event,
  };
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) entry[key] = value;
    }
  }

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, context?: LogContext) => write("debug", event, context),
  info: (event: string, context?: LogContext) => write("info", event, context),
  warn: (event: string, context?: LogContext) => write("warn", event, context),
  error: (event: string, context?: LogContext) => write("error", event, context),
};
