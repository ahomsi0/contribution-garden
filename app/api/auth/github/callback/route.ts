import {
  appendGitHubAuthResult,
  exchangeGitHubOAuthCode,
  githubOAuthConfigured,
  privateNoStoreHeaders,
  readGitHubOAuthTransaction,
  serializeClearGitHubOAuthTransactionCookie,
  serializeGitHubSessionCookie,
  timingSafeStringEqual,
} from "@/lib/github-auth";

function callbackRedirect(
  request: Request,
  returnTo: string,
  result: "connected" | "denied" | "failed",
  sessionCookie?: string,
) {
  const headers = privateNoStoreHeaders({
    Location: appendGitHubAuthResult(returnTo, result),
  });
  headers.append(
    "Set-Cookie",
    serializeClearGitHubOAuthTransactionCookie(request),
  );
  if (sessionCookie) headers.append("Set-Cookie", sessionCookie);
  return new Response(null, { status: 303, headers });
}

export async function GET(request: Request) {
  if (!githubOAuthConfigured()) {
    return Response.json(
      { error: "GitHub connection is not configured." },
      { status: 503, headers: privateNoStoreHeaders() },
    );
  }

  const url = new URL(request.url);
  const transaction = await readGitHubOAuthTransaction(request);
  const returnTo = transaction?.returnTo ?? "/";
  const state = url.searchParams.get("state") ?? "";
  if (
    !transaction ||
    !state ||
    !timingSafeStringEqual(state, transaction.state)
  ) {
    return callbackRedirect(request, returnTo, "failed");
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return callbackRedirect(
      request,
      returnTo,
      oauthError === "access_denied" ? "denied" : "failed",
    );
  }

  const code = url.searchParams.get("code") ?? "";
  try {
    const session = await exchangeGitHubOAuthCode(
      code,
      transaction.codeVerifier,
    );
    return callbackRedirect(
      request,
      transaction.returnTo,
      "connected",
      await serializeGitHubSessionCookie(session, request),
    );
  } catch {
    return callbackRedirect(request, transaction.returnTo, "failed");
  }
}
