/**
 * The two GitHub identities the review gate uses.
 *
 * Every read — reviews, threads, comments, reactions, check runs, the head's
 * push time — uses a GitHub App installation token. An installation has its
 * own rate-limit buckets, so a gate polling for an hour no longer spends the
 * owner's personal GraphQL allowance, which every agent session and `gh`
 * call on his account shares.
 *
 * The one write, a review-request comment such as `@codex review`, stays on
 * `GITHUB_REVIEW_TOKEN`, the owner's review token: a provider honors its
 * trigger command only from an account it serves, and Codex does not answer a
 * GitHub App bot. That is at most two comments per provider per head.
 *
 * There is no fallback from one identity to the other. A gate that cannot mint
 * its read token fails rather than quietly returning to the shared bucket.
 */

import {
  createGitHubAppInstallationToken,
  type GitHubAppEnv,
  type GitHubAppTokenResult,
} from "../../../packages/temporal/src/lib/github-app-token.ts";

/** The owner's token, used only to post review-request comments. */
export const REVIEW_REQUEST_TOKEN_ENV = "GITHUB_REVIEW_TOKEN";

/**
 * Refresh this long before expiry. Installation tokens last an hour and the
 * gate's deadline is an hour of polling after its startup, so a single token
 * would expire under a slow review; the margin also covers a tick's own
 * duration and clock skew.
 */
export const READ_TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;

export type ReviewGateCredentials = {
  /** Resolve the current installation token, minting a new one near expiry. */
  readToken: () => Promise<string>;
  requestToken: string;
};

type Environment = Record<string, string | undefined>;

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required for the review gate`);
  }
  return value;
}

/**
 * A token source that mints on first use and again once the held token is
 * within {@link READ_TOKEN_REFRESH_MARGIN_MS} of expiry. Each mint logs the
 * identity and expiry — never the token — so a gate's log shows which bucket
 * its reads drew on.
 */
export function installationTokenSource(input: {
  installationId: string;
  mint: () => Promise<GitHubAppTokenResult>;
  now?: () => number;
}): () => Promise<string> {
  const now = input.now ?? (() => Date.now());
  let held: GitHubAppTokenResult | null = null;
  return async () => {
    if (
      held === null ||
      held.expiresAt.getTime() - now() <= READ_TOKEN_REFRESH_MARGIN_MS
    ) {
      held = await input.mint();
      console.log(
        `Review gate GitHub reads authenticate as GitHub App installation ${input.installationId} ` +
          `(installation token, expires ${held.expiresAt.toISOString()}); ` +
          `review requests post with ${REVIEW_REQUEST_TOKEN_ENV}.`,
      );
    }
    return held.token;
  };
}

/**
 * Read both identities from the step environment. Missing credentials fail
 * here, before the first poll, rather than surfacing as a GitHub 401 later.
 */
export function reviewGateCredentials(
  environment: Environment = Bun.env,
  mint: (env: GitHubAppEnv) => Promise<GitHubAppTokenResult> = async (env) =>
    createGitHubAppInstallationToken({ env }),
): ReviewGateCredentials {
  const appId = required(environment, "GITHUB_APP_ID");
  const installationId = required(environment, "GITHUB_APP_INSTALLATION_ID");
  const privateKey = required(environment, "GITHUB_APP_PRIVATE_KEY");
  const requestToken = required(environment, REVIEW_REQUEST_TOKEN_ENV);
  const appEnv: GitHubAppEnv = {
    GITHUB_APP_ID: appId,
    GITHUB_APP_INSTALLATION_ID: installationId,
    GITHUB_APP_PRIVATE_KEY: privateKey,
  };
  return {
    readToken: installationTokenSource({
      installationId: installationId.trim(),
      mint: async () => mint(appEnv),
    }),
    requestToken,
  };
}
