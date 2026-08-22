import {
  getGitHubOAuthConfig,
  githubOAuthConfigured,
  privateNoStoreHeaders,
  serializeClearGitHubOAuthTransactionCookie,
  serializeClearGitHubSessionCookie,
} from "@/lib/github-auth";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const expectedOrigin = githubOAuthConfigured()
      ? new URL(getGitHubOAuthConfig().callbackUrl).origin
      : new URL(request.url).origin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const headers = privateNoStoreHeaders();
  if (!sameOrigin(request)) {
    return Response.json(
      { error: "The logout request was rejected." },
      { status: 403, headers },
    );
  }

  headers.append("Set-Cookie", serializeClearGitHubSessionCookie(request));
  headers.append(
    "Set-Cookie",
    serializeClearGitHubOAuthTransactionCookie(request),
  );
  return new Response(null, { status: 204, headers });
}
