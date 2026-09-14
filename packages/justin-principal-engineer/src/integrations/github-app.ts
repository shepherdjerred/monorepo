import { createPrivateKey } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { Config } from "#src/domain/schemas.ts";
import { readOpReference } from "#src/integrations/secrets.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import type { CommandRunner } from "#src/runtime/process.ts";

export type GitHubAuth = Readonly<{
  env: Readonly<Record<string, string>>;
  cleanup: () => Promise<void>;
}>;

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function appJwt(appId: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const payload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({ iat: now - 60, exp: now + 8 * 60, iss: appId }),
    ),
  );
  const input = `${header}.${payload}`;
  const normalized = `${privateKey.replaceAll(String.raw`\n`, "\n").trim()}\n`;
  const der = createPrivateKey({ key: normalized, format: "pem" }).export({
    format: "der",
    type: "pkcs8",
  });
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}

async function installationToken(input: {
  appId: string;
  installationId: string;
  privateKey: string;
}): Promise<string> {
  const jwt = await appJwt(input.appId, input.privateKey);
  const response = await fetch(
    `https://api.github.com/app/installations/${input.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub App installation token request failed with ${String(response.status)}`,
    );
  }
  const body: unknown = await response.json();
  if (body === null || typeof body !== "object" || !("token" in body)) {
    throw new Error("GitHub App token response did not contain a token");
  }
  const token = body.token;
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("GitHub App token response contained an invalid token");
  }
  return token;
}

export async function createGitHubAuth(
  config: Config,
  paths: RuntimePaths,
  run: CommandRunner,
): Promise<GitHubAuth> {
  const [appId, installationId, privateKey] = await Promise.all([
    readOpReference(config.github.appId, run),
    readOpReference(config.github.installationId, run),
    readOpReference(config.github.privateKey, run),
  ]);
  if (!/^\d+$/.test(appId) || !/^\d+$/.test(installationId)) {
    throw new Error("GitHub App and installation IDs must be numeric");
  }
  const token = await installationToken({ appId, installationId, privateKey });
  const authDirectory = path.join(paths.root, "auth");
  await mkdir(authDirectory, { recursive: true });
  const askpass = path.join(authDirectory, `${crypto.randomUUID()}.sh`);
  await Bun.write(
    askpass,
    [
      "#!/bin/sh",
      'case "$1" in',
      String.raw`  *Username*) printf "%s%s%s\n" "x-access" "-" "token" ;;`,
      String.raw`  *) printf "%s\n" "$GH_TOKEN" ;;`,
      "esac",
      "",
    ].join("\n"),
  );
  await chmod(askpass, 0o700);
  return {
    env: {
      GH_TOKEN: token,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
    },
    cleanup: async () => {
      await rm(askpass, { force: true });
    },
  };
}
