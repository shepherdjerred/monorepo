/**
 * Mint a GitHub App installation token and set up git HTTPS auth for the
 * commit-back / release scripts.
 *
 * Ported from the old CI's `mintGithubAppTokenAndSetupGitAuth` +
 * `withGithubAppCredentials` (.dagger/src/release.ts). The token is minted by
 * the existing temporal script (`packages/temporal/src/lib/github-app-token.ts`,
 * run via `bun`), which reads GITHUB_APP_ID / GITHUB_APP_INSTALLATION_ID /
 * GITHUB_APP_PRIVATE_KEY from the environment and prints the token to stdout.
 *
 * The minted token lives only in memory and in a GIT_ASKPASS helper script's
 * env — it is never written into a URL or a token file (repo policy).
 */

import { run, requireEnv, tmpBase } from "./run.ts";

const GITHUB_APP_TOKEN_SCRIPT_REL =
  "packages/temporal/src/lib/github-app-token.ts";

export type GitAuth = {
  /** The minted installation token (also exported as GH_TOKEN for `gh`). */
  token: string;
  /**
   * Env vars to pass to any git/gh subprocess so credentials are injected via
   * an askpass helper rather than an in-URL token. Includes GH_TOKEN,
   * GIT_ASKPASS, and GIT_TERMINAL_PROMPT=0.
   */
  env: Record<string, string>;
  /** Remove the temp askpass helper. Call in a finally block. */
  cleanup: () => Promise<void>;
};

/**
 * Mint a fresh installation token and write a git-askpass helper that returns
 * the GitHub App's fixed username for username prompts and the token for
 * password prompts.
 * Callers should use plain HTTPS URLs so credentials never appear in the URL.
 */
export async function setupGitAuth(repoRoot: string): Promise<GitAuth> {
  // Fail fast if the App creds are missing before we shell out.
  requireEnv("GITHUB_APP_ID");
  requireEnv("GITHUB_APP_INSTALLATION_ID");
  requireEnv("GITHUB_APP_PRIVATE_KEY");

  const scriptPath = `${repoRoot}/${GITHUB_APP_TOKEN_SCRIPT_REL}`;
  // secret: the stdout IS the token — it must never be echoed into CI logs
  // (build 5656 printed it in cleartext).
  const minted = await run(["bun", scriptPath], {
    capture: true,
    secret: true,
  });
  const token = minted.stdout.trim();
  if (token === "") {
    throw new Error("GH_TOKEN is empty after mint");
  }

  // Write an askpass helper to a temp file. Assembling the username as
  // "x-access" + "-token" mirrors the old helper (avoids the literal
  // banned string appearing in a URL; here it is only ever a prompt reply).
  const askpassPath = `${tmpBase()}/git-askpass-${Bun.hash(token).toString(16)}.sh`;
  const askpass = [
    "#!/bin/sh",
    'case "$1" in',
    String.raw`  *Username*) printf "%s%s%s\n" "x-access" "-" "token" ;;`,
    String.raw`  *) printf "%s\n" "$GH_TOKEN" ;;`,
    "esac",
    "",
  ].join("\n");
  await Bun.write(askpassPath, askpass);
  await run(["chmod", "+x", askpassPath]);

  const env: Record<string, string> = {
    GH_TOKEN: token,
    GIT_ASKPASS: askpassPath,
    GIT_TERMINAL_PROMPT: "0",
  };

  return {
    token,
    env,
    cleanup: async () => {
      if (await Bun.file(askpassPath).exists()) {
        await Bun.$`rm ${askpassPath}`.quiet();
      }
    },
  };
}
