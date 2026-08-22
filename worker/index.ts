/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { logger } from "@/lib/logger";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

/**
 * Baseline security headers applied to every response. A strict
 * Content-Security-Policy is intentionally limited to frame-ancestors because
 * the app framework injects inline scripts/styles; clickjacking protection
 * does not depend on that.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function withSecurityHeaders(response: Response, request: Request): Response {
  // Rebuild headers instead of mutating (responses may be immutable outside
  // workerd), copying Set-Cookie entries individually so duplicates survive.
  const headers = new Headers();
  for (const [name, value] of response.headers.entries()) {
    if (name.toLowerCase() !== "set-cookie") headers.set(name, value);
  }
  const getCookies = (response.headers as Headers & {
    getSetCookie?: () => string[];
  }).getSetCookie;
  if (typeof getCookies === "function") {
    for (const cookie of getCookies.call(response.headers)) {
      headers.append("Set-Cookie", cookie);
    }
  }

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (
    !headers.has("Strict-Transport-Security") &&
    new URL(request.url).protocol === "https:"
  ) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

const worker = {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    ctx.passThroughOnException();
    try {
      const url = new URL(request.url);

      if (url.pathname === "/_vinext/image") {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        const response = await handleImageOptimization(request, {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
            return result.response();
          },
        }, allowedWidths);
        return withSecurityHeaders(response, request);
      }

      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(response, request);
    } catch (error) {
      logger.error("worker_unhandled_exception", {
        path: new URL(request.url).pathname,
        method: request.method,
        errorName: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message.slice(0, 300) : undefined,
      });
      if (request.headers.get("accept")?.includes("text/html")) {
        return new Response(
          "<!doctype html><title>Something wilted</title><h1>Something wilted</h1><p>The garden hit an unexpected error. Please try again.</p>",
          {
            status: 500,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          },
        );
      }
      return jsonError(500, "The garden hit an unexpected error. Please try again.");
    }
  },
};

export default worker;
