import { createPrivateKey } from "node:crypto";

export type GitHubAppEnv = {
  readonly GITHUB_APP_ID?: string;
  readonly GITHUB_APP_INSTALLATION_ID?: string;
  readonly GITHUB_APP_PRIVATE_KEY?: string;
  readonly GITHUB_API_URL?: string;
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type GitHubAppTokenDeps = {
  readonly env?: GitHubAppEnv;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
};

export type GitHubAppTokenResult = {
  readonly token: string;
  readonly expiresAt: Date;
};

const DEFAULT_GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const JWT_TTL_SECONDS = 9 * 60;

function requiredEnv(env: GitHubAppEnv, key: keyof GitHubAppEnv): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${key} is required for GitHub App authentication`);
  }
  return value.trim();
}

function requireNumericEnv(env: GitHubAppEnv, key: keyof GitHubAppEnv): string {
  const value = requiredEnv(env, key);
  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be a numeric GitHub App identifier`);
  }
  return value;
}

export function normalizePrivateKey(privateKey: string): string {
  const normalized = privateKey.replaceAll(String.raw`\n`, "\n").trim();
  if (
    !normalized.includes("-----BEGIN") ||
    !normalized.includes("PRIVATE KEY-----")
  ) {
    throw new Error("GITHUB_APP_PRIVATE_KEY must be a PEM private key");
  }
  return `${normalized}\n`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function utf8Base64UrlEncode(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // GitHub's App settings UI downloads keys in PKCS#1 form
  // (`BEGIN RSA PRIVATE KEY`), but WebCrypto's importKey only takes PKCS#8.
  // node:crypto's createPrivateKey accepts both formats, so we round-trip
  // through it to land in PKCS#8 DER before handing off to WebCrypto.
  const normalized = normalizePrivateKey(pem);
  const pkcs8Der = createPrivateKey({ key: normalized, format: "pem" }).export({
    format: "der",
    type: "pkcs8",
  });
  return await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function processEnv(): GitHubAppEnv {
  const appId = Bun.env["GITHUB_APP_ID"];
  const installationId = Bun.env["GITHUB_APP_INSTALLATION_ID"];
  const privateKey = Bun.env["GITHUB_APP_PRIVATE_KEY"];
  const apiUrl = Bun.env["GITHUB_API_URL"];
  return {
    ...(appId === undefined ? {} : { GITHUB_APP_ID: appId }),
    ...(installationId === undefined
      ? {}
      : { GITHUB_APP_INSTALLATION_ID: installationId }),
    ...(privateKey === undefined ? {} : { GITHUB_APP_PRIVATE_KEY: privateKey }),
    ...(apiUrl === undefined ? {} : { GITHUB_API_URL: apiUrl }),
  };
}

export async function createGitHubAppJwt(input: {
  readonly appId: string;
  readonly privateKey: string;
  readonly now?: () => number;
}): Promise<string> {
  const nowMs = input.now?.() ?? Date.now();
  const issuedAt = Math.floor(nowMs / 1000) - 60;
  const expiresAt = issuedAt + JWT_TTL_SECONDS;
  const header = utf8Base64UrlEncode(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  );
  const payload = utf8Base64UrlEncode(
    JSON.stringify({
      iat: issuedAt,
      exp: expiresAt,
      iss: input.appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(input.privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GitHub App token response must be an object");
  }
  return Object.fromEntries(Object.entries(value));
}

function parseAccessTokenResponse(
  value: unknown,
  nowMs: number,
): GitHubAppTokenResult {
  const response = requireRecord(value);

  const token = response["token"];
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("GitHub App token response did not include a token");
  }

  const expiresAtRaw = response["expires_at"];
  if (typeof expiresAtRaw !== "string" || expiresAtRaw.trim() === "") {
    throw new Error("GitHub App token response did not include expires_at");
  }

  const expiresAt = new Date(expiresAtRaw);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new TypeError(
      "GitHub App token response included invalid expires_at",
    );
  }
  if (expiresAt.getTime() <= nowMs) {
    throw new Error("GitHub App installation token is already expired");
  }

  return { token, expiresAt };
}

export async function createGitHubAppInstallationToken(
  deps: GitHubAppTokenDeps = {},
): Promise<GitHubAppTokenResult> {
  const env = deps.env ?? processEnv();
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const nowMs = now();
  const appId = requireNumericEnv(env, "GITHUB_APP_ID");
  const installationId = requireNumericEnv(env, "GITHUB_APP_INSTALLATION_ID");
  const privateKey = requiredEnv(env, "GITHUB_APP_PRIVATE_KEY");
  const apiBaseUrl = (env.GITHUB_API_URL ?? DEFAULT_GITHUB_API_URL).replace(
    /\/+$/,
    "",
  );
  const jwt = await createGitHubAppJwt({ appId, privateKey, now });
  const response = await fetchFn(
    `${apiBaseUrl}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      body: "{}",
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub App installation token request failed with ${String(response.status)} ${response.statusText}: ${body}`,
    );
  }

  return parseAccessTokenResponse(await response.json(), nowMs);
}

async function main(): Promise<void> {
  try {
    const result = await createGitHubAppInstallationToken();
    process.stdout.write(`${result.token}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
