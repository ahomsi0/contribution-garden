import {
  githubOAuthConfigured,
  privateNoStoreHeaders,
  resolveGitHubSession,
} from "@/lib/github-auth";

export async function GET(request: Request) {
  const headers = privateNoStoreHeaders({
    "Content-Type": "application/json; charset=utf-8",
  });
  if (!githubOAuthConfigured()) {
    return Response.json(
      { configured: false, authenticated: false },
      { headers },
    );
  }

  const resolution = await resolveGitHubSession(request);
  if (resolution.setCookie) {
    headers.append("Set-Cookie", resolution.setCookie);
  }
  return Response.json(
    resolution.session
      ? {
          configured: true,
          authenticated: true,
          account: resolution.session.account,
          refreshed: resolution.refreshed,
        }
      : {
          configured: true,
          authenticated: false,
          invalid: resolution.invalid,
        },
    { headers },
  );
}
