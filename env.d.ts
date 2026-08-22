/// <reference types="@cloudflare/workers-types" />

/**
 * Global Cloudflare Workers binding types shared by `worker/index.ts`,
 * `db/index.ts`, and any route that reads bindings through
 * `cloudflare:workers`. Optional bindings may be absent depending on the
 * deployment configuration (.openai/hosting.json / wrangler config).
 */
declare global {
  namespace Cloudflare {
    interface Env {
      /** Static asset serving binding. Always present for this app. */
      ASSETS: Fetcher;
      /** D1 database binding; only present when configured. */
      DB?: D1Database;
      /** Cloudflare Images binding used by the vinext image optimizer. */
      IMAGES: {
        input(stream: ReadableStream): {
          transform(options: Record<string, unknown>): {
            output(options: {
              format: string;
              quality: number;
            }): Promise<{ response(): Response }>;
          };
        };
      };
    }
  }
}

export {};
