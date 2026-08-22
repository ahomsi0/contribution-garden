import {
  GitHubAuthError,
  createGitHubOAuthTransaction,
  githubOAuthConfigured,
  privateNoStoreHeaders,
  serializeGitHubOAuthTransactionCookie,
} from "@/lib/github-auth";

export async function GET(request: Request) {
  const headers = privateNoStoreHeaders({ "Content-Type": "application/json" });
  if (!githubOAuthConfigured()) {
    return Response.json(
      { error: "GitHub connection is not configured." },
      { status: 503, headers },
    );
  }

  try {
    const returnTo = new URL(request.url).searchParams.get("return_to");
    const { transaction, authorizationUrl } =
      await createGitHubOAuthTransaction(returnTo);
    headers.delete("Content-Type");
    headers.set("Location", authorizationUrl);
    headers.append(
      "Set-Cookie",
      await serializeGitHubOAuthTransactionCookie(transaction, request),
    );
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const status = error instanceof GitHubAuthError ? error.status : 502;
    return Response.json(
      { error: "GitHub connection could not be started." },
      { status, headers },
    );
  }
}
