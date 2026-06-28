/**
 * Worker-side auth for the babysitter activities. Each git/gh-using activity
 * mints a FRESH GitHub App installation token (≈1h TTL) right before it runs, so
 * a long mutating iteration never races the token expiry, and points
 * `GIT_ASKPASS` at the shared helper for git over HTTPS. The local PoC bypasses
 * this entirely (ambient `gh` credentials), so it lives in the activity layer,
 * not in the pure Phase-0 functions.
 */
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { ensureBabysitAskpass } from "./ensure-workdir.ts";

export type BabysitAuth = {
  token: string;
  /** Env for gh + git: `GH_TOKEN` + `GIT_ASKPASS` + terminal-prompt off. */
  env: Record<string, string>;
};

export async function mintBabysitAuth(): Promise<BabysitAuth> {
  const { token } = await createGitHubAppInstallationToken();
  const askpass = await ensureBabysitAskpass();
  return {
    token,
    env: {
      GH_TOKEN: token,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
    },
  };
}
