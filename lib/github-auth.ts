/**
 * Stateless GitHub App OAuth helpers.
 *
 * This module is server-only by convention: it reads server secrets and
 * handles GitHub access and refresh tokens. Do not import it from client code.
 */

import { logger } from "@/lib/logger";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_API_VERSION = "2026-03-10";

const SESSION_COOKIE_NAME = "cg_github_session";
const TRANSACTION_COOKIE_NAME = "cg_github_oauth";
const SESSION_COOKIE_PURPOSE = "contribution-garden:github-session:v1";
const TRANSACTION_COOKIE_PURPOSE = "contribution-garden:github-oauth:v1";
const COOKIE_VALUE_VERSION = "v1";

const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_COOKIE_VALUE_LENGTH = 3_800;
const MAX_RETURN_TO_LENGTH = 2_048;
const MAX_TOKEN_LENGTH = 2_048;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  sessionSecret: string;
}

export interface GitHubOAuthAccount {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  profileUrl: string;
}

export interface GitHubOAuthSession {
  version: 1;
  login: string;
  account: GitHubOAuthAccount;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
}

export interface GitHubOAuthTransaction {
  version: 1;
  state: string;
  codeVerifier: string;
  returnTo: string;
  issuedAt: number;
}

export interface GitHubSessionReadResult {
  session: GitHubOAuthSession | null;
  invalid: boolean;
}

export interface GitHubSessionResolution extends GitHubSessionReadResult {
  refreshed: boolean;
  /** A complete Set-Cookie header value when the caller must rotate or clear it. */
  setCookie?: string;
}

export interface ResolveGitHubSessionOptions {
  /** Defaults to true. */
  refresh?: boolean;
  /** Defaults to five minutes before access-token expiry. */
  refreshWithinMs?: number;
}

export type GitHubAuthErrorCode =
  | "not_configured"
  | "invalid_session"
  | "token_exchange_failed"
  | "refresh_failed"
  | "github_unavailable";

export class GitHubAuthError extends Error {
  constructor(
    readonly code: GitHubAuthErrorCode,
    readonly status: 400 | 401 | 502 | 503,
    message: string,
  ) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

interface GitHubTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
  token_type?: unknown;
  error?: unknown;
}

interface GitHubUserResponse {
  login?: unknown;
  name?: unknown;
  avatar_url?: unknown;
  html_url?: unknown;
}

function envValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function configuredValues(): GitHubOAuthConfig {
  return {
    clientId: envValue("GITHUB_APP_CLIENT_ID"),
    clientSecret: envValue("GITHUB_APP_CLIENT_SECRET"),
    callbackUrl: envValue("GITHUB_APP_CALLBACK_URL"),
    sessionSecret: envValue("GITHUB_SESSION_SECRET"),
  };
}

export function githubOAuthConfigured(): boolean {
  const config = configuredValues();
  if (
    !config.clientId ||
    !config.clientSecret ||
    !config.callbackUrl ||
    config.sessionSecret.length < 32
  ) {
    return false;
  }

  try {
    const callbackUrl = new URL(config.callbackUrl);
    if (callbackUrl.username || callbackUrl.password || callbackUrl.hash) {
      return false;
    }
    if (callbackUrl.protocol === "https:") return true;
    return (
      callbackUrl.protocol === "http:" &&
      (callbackUrl.hostname === "localhost" ||
        callbackUrl.hostname === "127.0.0.1" ||
        callbackUrl.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

export function getGitHubOAuthConfig(): GitHubOAuthConfig {
  const config = configuredValues();
  if (!githubOAuthConfigured()) {
    throw new GitHubAuthError(
      "not_configured",
      503,
      "GitHub connection is not configured.",
    );
  }
  return config;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url value.");
  }

  const paddingLength = (4 - (value.length % 4)) % 4;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(paddingLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function encryptionKey(): Promise<CryptoKey> {
  const secret = getGitHubOAuthConfig().sessionSecret;
  const keyBytes = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret));
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function sealPayload(
  payload: object,
  purpose: string,
): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: textEncoder.encode(purpose),
      tagLength: 128,
    },
    await encryptionKey(),
    textEncoder.encode(JSON.stringify(payload)),
  );
  const value = `${COOKIE_VALUE_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(
    new Uint8Array(ciphertext),
  )}`;

  if (value.length > MAX_COOKIE_VALUE_LENGTH) {
    throw new GitHubAuthError(
      "invalid_session",
      400,
      "The encrypted GitHub session is too large.",
    );
  }
  return value;
}

async function openPayload(value: string, purpose: string): Promise<unknown> {
  if (!value || value.length > MAX_COOKIE_VALUE_LENGTH) {
    throw new Error("Invalid encrypted cookie.");
  }

  const parts = value.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== COOKIE_VALUE_VERSION ||
    !parts[1] ||
    !parts[2]
  ) {
    throw new Error("Invalid encrypted cookie.");
  }

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(parts[1]),
      additionalData: textEncoder.encode(purpose),
      tagLength: 128,
    },
    await encryptionKey(),
    base64UrlToBytes(parts[2]),
  );
  return JSON.parse(textDecoder.decode(plaintext)) as unknown;
}

function cookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const candidateName = part.slice(0, separator).trim();
    if (candidateName !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function isSecureRequest(requestOrUrl: Request | URL | string): boolean {
  const value =
    requestOrUrl instanceof Request
      ? requestOrUrl.url
      : requestOrUrl instanceof URL
        ? requestOrUrl.href
        : requestOrUrl;
  return new URL(value).protocol === "https:";
}

function serializeCookie(
  name: string,
  value: string,
  requestOrUrl: Request | URL | string,
  maxAgeSeconds: number,
  path = "/",
): string {
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds));
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    `Expires=${new Date(Date.now() + maxAge * 1_000).toUTCString()}`,
  ];
  if (isSecureRequest(requestOrUrl)) parts.push("Secure");
  return parts.join("; ");
}

function serializeClearCookie(
  name: string,
  requestOrUrl: Request | URL | string,
  path = "/",
): string {
  const parts = [
    `${name}=`,
    `Path=${path}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (isSecureRequest(requestOrUrl)) parts.push("Secure");
  return parts.join("; ");
}

function isToken(value: unknown, prefix: "ghu_" | "ghr_"): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(prefix) &&
    value.length <= MAX_TOKEN_LENGTH &&
    !/\s/.test(value)
  );
}

function isLogin(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value)
  );
}

function safeAccountText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 160) : null;
}

function safeGitHubUrl(
  value: unknown,
  allowedHosts: readonly string[],
): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !allowedHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function parseAccount(value: unknown): GitHubOAuthAccount | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<GitHubOAuthAccount>;
  if (!isLogin(candidate.login)) return null;
  const login = candidate.login.toLowerCase();
  const profileUrl =
    safeGitHubUrl(candidate.profileUrl, ["github.com"]) ??
    `https://github.com/${encodeURIComponent(login)}`;
  return {
    login,
    name: safeAccountText(candidate.name),
    avatarUrl: safeGitHubUrl(candidate.avatarUrl, [
      "github.com",
      "githubusercontent.com",
    ]),
    profileUrl,
  };
}

function isFiniteTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function parseSession(value: unknown): GitHubOAuthSession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<GitHubOAuthSession>;
  const account = parseAccount(candidate.account);
  if (
    candidate.version !== 1 ||
    !isLogin(candidate.login) ||
    !account ||
    account.login !== candidate.login.toLowerCase() ||
    !isToken(candidate.accessToken, "ghu_") ||
    !isFiniteTimestamp(candidate.accessTokenExpiresAt) ||
    !isToken(candidate.refreshToken, "ghr_") ||
    !isFiniteTimestamp(candidate.refreshTokenExpiresAt)
  ) {
    return null;
  }
  return {
    version: 1,
    login: candidate.login.toLowerCase(),
    account,
    accessToken: candidate.accessToken,
    accessTokenExpiresAt: candidate.accessTokenExpiresAt,
    refreshToken: candidate.refreshToken,
    refreshTokenExpiresAt: candidate.refreshTokenExpiresAt,
  };
}

function parseTransaction(value: unknown): GitHubOAuthTransaction | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<GitHubOAuthTransaction>;
  if (
    candidate.version !== 1 ||
    typeof candidate.state !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(candidate.state) ||
    typeof candidate.codeVerifier !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(candidate.codeVerifier) ||
    typeof candidate.returnTo !== "string" ||
    typeof candidate.issuedAt !== "number" ||
    !Number.isFinite(candidate.issuedAt)
  ) {
    return null;
  }
  return {
    version: 1,
    state: candidate.state,
    codeVerifier: candidate.codeVerifier,
    returnTo: sanitizeReturnTo(candidate.returnTo),
    issuedAt: candidate.issuedAt,
  };
}

export function sanitizeReturnTo(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (
    !value ||
    value.length > MAX_RETURN_TO_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n\0]/.test(value)
  ) {
    return fallback;
  }

  try {
    const base = new URL("https://contribution-garden.invalid");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function appendGitHubAuthResult(
  returnTo: string,
  result: "connected" | "denied" | "failed",
): string {
  const parsed = new URL(
    sanitizeReturnTo(returnTo),
    "https://contribution-garden.invalid",
  );
  parsed.searchParams.set("github", result);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function timingSafeStringEqual(left: string, right: string): boolean {
  const maximumLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maximumLength; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function createGitHubOAuthTransaction(
  returnTo: string | null | undefined,
): Promise<{
  transaction: GitHubOAuthTransaction;
  authorizationUrl: string;
}> {
  const config = getGitHubOAuthConfig();
  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(32);
  const challengeDigest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(codeVerifier),
  );
  const authorizationUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.callbackUrl);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set(
    "code_challenge",
    bytesToBase64Url(new Uint8Array(challengeDigest)),
  );
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return {
    transaction: {
      version: 1,
      state,
      codeVerifier,
      returnTo: sanitizeReturnTo(returnTo),
      issuedAt: Date.now(),
    },
    authorizationUrl: authorizationUrl.toString(),
  };
}

export async function serializeGitHubOAuthTransactionCookie(
  transaction: GitHubOAuthTransaction,
  requestOrUrl: Request | URL | string,
): Promise<string> {
  return serializeCookie(
    TRANSACTION_COOKIE_NAME,
    await sealPayload(transaction, TRANSACTION_COOKIE_PURPOSE),
    requestOrUrl,
    OAUTH_TRANSACTION_TTL_MS / 1_000,
    "/api/auth/github",
  );
}

export function serializeClearGitHubOAuthTransactionCookie(
  requestOrUrl: Request | URL | string,
): string {
  return serializeClearCookie(
    TRANSACTION_COOKIE_NAME,
    requestOrUrl,
    "/api/auth/github",
  );
}

export async function readGitHubOAuthTransaction(
  request: Request,
): Promise<GitHubOAuthTransaction | null> {
  const value = cookieValue(request, TRANSACTION_COOKIE_NAME);
  if (!value) return null;

  try {
    const transaction = parseTransaction(
      await openPayload(value, TRANSACTION_COOKIE_PURPOSE),
    );
    if (
      !transaction ||
      transaction.issuedAt > Date.now() + 30_000 ||
      Date.now() - transaction.issuedAt > OAUTH_TRANSACTION_TTL_MS
    ) {
      return null;
    }
    return transaction;
  } catch {
    return null;
  }
}

function sessionCookieMaxAgeSeconds(session: GitHubOAuthSession): number {
  return Math.max(
    0,
    Math.floor((session.refreshTokenExpiresAt - Date.now()) / 1_000),
  );
}

export async function serializeGitHubSessionCookie(
  session: GitHubOAuthSession,
  requestOrUrl: Request | URL | string,
): Promise<string> {
  const maxAge = sessionCookieMaxAgeSeconds(session);
  if (maxAge <= 0) {
    return serializeClearGitHubSessionCookie(requestOrUrl);
  }
  return serializeCookie(
    SESSION_COOKIE_NAME,
    await sealPayload(session, SESSION_COOKIE_PURPOSE),
    requestOrUrl,
    maxAge,
  );
}

export function serializeClearGitHubSessionCookie(
  requestOrUrl: Request | URL | string,
): string {
  return serializeClearCookie(SESSION_COOKIE_NAME, requestOrUrl);
}

export async function readGitHubSession(
  request: Request,
): Promise<GitHubSessionReadResult> {
  const value = cookieValue(request, SESSION_COOKIE_NAME);
  if (!value) return { session: null, invalid: false };

  try {
    const session = parseSession(await openPayload(value, SESSION_COOKIE_PURPOSE));
    if (
      !session ||
      session.refreshTokenExpiresAt <= Date.now() ||
      session.accessTokenExpiresAt > session.refreshTokenExpiresAt
    ) {
      return { session: null, invalid: true };
    }
    return { session, invalid: false };
  } catch {
    return { session: null, invalid: true };
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
): Promise<Response> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: abortController.signal });
  } catch (error) {
    if (error instanceof GitHubAuthError) throw error;
    // Network failures and timeout aborts both mean GitHub could not be
    // reached; anything else is a bug worth surfacing instead of masking.
    logger.warn("github_auth_fetch_failed", {
      host: new URL(input).host,
      aborted: abortController.signal.aborted,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    if (abortController.signal.aborted) {
      throw new GitHubAuthError(
        "github_unavailable",
        502,
        "GitHub is temporarily unavailable.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function tokenResponse(
  parameters: URLSearchParams,
  failureCode: "token_exchange_failed" | "refresh_failed",
): Promise<GitHubTokenResponse> {
  const response = await fetchWithTimeout(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: parameters,
    redirect: "error",
  });

  let payload: GitHubTokenResponse;
  try {
    payload = (await response.json()) as GitHubTokenResponse;
  } catch {
    throw new GitHubAuthError(
      failureCode,
      failureCode === "refresh_failed" ? 401 : 502,
      failureCode === "refresh_failed"
        ? "The GitHub session could not be refreshed."
        : "GitHub authorization could not be completed.",
    );
  }

  if (!response.ok || payload.error) {
    throw new GitHubAuthError(
      failureCode,
      failureCode === "refresh_failed" ? 401 : 502,
      failureCode === "refresh_failed"
        ? "The GitHub session could not be refreshed."
        : "GitHub authorization could not be completed.",
    );
  }
  return payload;
}

function positiveSeconds(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 31_536_000
    ? Math.floor(value)
    : null;
}

function sessionFromTokenResponse(
  payload: GitHubTokenResponse,
  account: GitHubOAuthAccount,
  errorCode: "token_exchange_failed" | "refresh_failed",
): GitHubOAuthSession {
  const expiresIn = positiveSeconds(payload.expires_in);
  const refreshExpiresIn = positiveSeconds(payload.refresh_token_expires_in);
  if (
    !isToken(payload.access_token, "ghu_") ||
    !isToken(payload.refresh_token, "ghr_") ||
    !expiresIn ||
    !refreshExpiresIn
  ) {
    throw new GitHubAuthError(
      errorCode,
      errorCode === "refresh_failed" ? 401 : 502,
      errorCode === "refresh_failed"
        ? "The GitHub session could not be refreshed."
        : "GitHub authorization could not be completed.",
    );
  }

  const now = Date.now();
  return {
    version: 1,
    login: account.login,
    account,
    accessToken: payload.access_token,
    accessTokenExpiresAt: now + expiresIn * 1_000,
    refreshToken: payload.refresh_token,
    refreshTokenExpiresAt: now + refreshExpiresIn * 1_000,
  };
}

export async function exchangeGitHubOAuthCode(
  code: string,
  codeVerifier: string,
): Promise<GitHubOAuthSession> {
  if (
    !code ||
    code.length > 512 ||
    /\s/.test(code) ||
    !/^[A-Za-z0-9_-]{43}$/.test(codeVerifier)
  ) {
    throw new GitHubAuthError(
      "token_exchange_failed",
      400,
      "GitHub authorization could not be completed.",
    );
  }

  const config = getGitHubOAuthConfig();
  const parameters = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.callbackUrl,
    code_verifier: codeVerifier,
  });
  const payload = await tokenResponse(parameters, "token_exchange_failed");
  if (!isToken(payload.access_token, "ghu_")) {
    throw new GitHubAuthError(
      "token_exchange_failed",
      502,
      "GitHub authorization could not be completed.",
    );
  }

  const userResponse = await fetchWithTimeout(GITHUB_USER_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${payload.access_token}`,
      "User-Agent": "Contribution-Garden",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    redirect: "error",
  });
  let user: GitHubUserResponse;
  try {
    user = (await userResponse.json()) as GitHubUserResponse;
  } catch {
    throw new GitHubAuthError(
      "token_exchange_failed",
      502,
      "GitHub authorization could not be completed.",
    );
  }
  if (!userResponse.ok || !isLogin(user.login)) {
    throw new GitHubAuthError(
      "token_exchange_failed",
      userResponse.status === 401 ? 401 : 502,
      "GitHub authorization could not be completed.",
    );
  }

  const login = user.login.toLowerCase();
  const account: GitHubOAuthAccount = {
    login,
    name: safeAccountText(user.name),
    avatarUrl: safeGitHubUrl(user.avatar_url, [
      "github.com",
      "githubusercontent.com",
    ]),
    profileUrl:
      safeGitHubUrl(user.html_url, ["github.com"]) ??
      `https://github.com/${encodeURIComponent(login)}`,
  };
  return sessionFromTokenResponse(payload, account, "token_exchange_failed");
}

/**
 * In-flight refresh single-flight. Concurrent requests that share a session
 * (and its refresh token) must not each trigger a token refresh: GitHub may
 * rotate the refresh token, and the losers of that race would invalidate the
 * winner's new token or clear an otherwise valid session.
 */
const inflightRefreshes = new Map<string, Promise<GitHubOAuthSession>>();

async function refreshGitHubTokens(
  session: GitHubOAuthSession,
): Promise<GitHubOAuthSession> {
  const inflightKey = session.refreshToken;
  const existing = inflightRefreshes.get(inflightKey);
  if (existing) return existing;

  const pending = (async () => {
    const config = getGitHubOAuthConfig();
    const payload = await tokenResponse(
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
      }),
      "refresh_failed",
    );
    return sessionFromTokenResponse(payload, session.account, "refresh_failed");
  })().finally(() => {
    inflightRefreshes.delete(inflightKey);
  });

  inflightRefreshes.set(inflightKey, pending);
  return pending;
}

export async function forceRefreshGitHubSession(
  session: GitHubOAuthSession,
  requestOrUrl: Request | URL | string,
): Promise<GitHubSessionResolution> {
  if (session.refreshTokenExpiresAt <= Date.now()) {
    return {
      session: null,
      invalid: true,
      refreshed: false,
      setCookie: serializeClearGitHubSessionCookie(requestOrUrl),
    };
  }

  const refreshedSession = await refreshGitHubTokens(session);
  return {
    session: refreshedSession,
    invalid: false,
    refreshed: true,
    setCookie: await serializeGitHubSessionCookie(
      refreshedSession,
      requestOrUrl,
    ),
  };
}

export async function resolveGitHubSession(
  request: Request,
  options: ResolveGitHubSessionOptions = {},
): Promise<GitHubSessionResolution> {
  const readResult = await readGitHubSession(request);
  if (!readResult.session) {
    return {
      ...readResult,
      refreshed: false,
      setCookie: readResult.invalid
        ? serializeClearGitHubSessionCookie(request)
        : undefined,
    };
  }

  const refresh = options.refresh ?? true;
  const refreshWithinMs = Math.max(
    0,
    options.refreshWithinMs ?? DEFAULT_REFRESH_WINDOW_MS,
  );
  if (
    !refresh ||
    readResult.session.accessTokenExpiresAt > Date.now() + refreshWithinMs
  ) {
    return { ...readResult, refreshed: false };
  }

  try {
    return await forceRefreshGitHubSession(readResult.session, request);
  } catch (error) {
    logger.warn("github_session_refresh_failed", {
      login: readResult.session.login,
      errorName: error instanceof Error ? error.name : "unknown",
      code: error instanceof GitHubAuthError ? error.code : "unknown",
    });
    return {
      session: null,
      invalid: true,
      refreshed: false,
      setCookie: serializeClearGitHubSessionCookie(request),
    };
  }
}

export function privateNoStoreHeaders(
  initial?: HeadersInit,
): Headers {
  const headers = new Headers(initial);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  const vary = new Set(
    (headers.get("Vary") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  vary.add("Cookie");
  vary.add("Accept-Encoding");
  headers.set("Vary", [...vary].join(", "));
  return headers;
}
