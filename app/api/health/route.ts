import { logger } from "@/lib/logger";

/**
 * Liveness/readiness probe for uptime monitors and load balancers.
 * Reports which data sources are configured — never secret values.
 */
export async function GET() {
  const oauthClientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  const legacyToken = process.env.GITHUB_TOKEN?.trim();

  const body = {
    ok: true,
    service: "contribution-garden",
    time: new Date().toISOString(),
    liveGitLabData: true,
    liveGitHubData: Boolean((oauthClientId && oauthClientSecret) || legacyToken),
    visitorAuth: Boolean(
      process.env.GITHUB_APP_CLIENT_ID?.trim() &&
        process.env.GITHUB_APP_CLIENT_SECRET?.trim(),
    ),
  };

  if (!body.liveGitHubData) {
    logger.warn("health_live_github_missing");
  }

  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
