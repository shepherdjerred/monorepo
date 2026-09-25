/**
 * Who this CI will generate a pipeline for.
 *
 * CI runs on one person's hardware for one person's repository, and its steps
 * mount production credentials: Cloudflare and Tailscale tokens, an ArgoCD
 * token, OpenTofu state keys, an npm token, a GitHub App private key. There is
 * no audience for whom running it is worth that exposure except the owner and
 * the bots acting on his behalf, so everyone else is refused here.
 *
 * This is the layer that can be reviewed in a pull request. Woodpecker's own
 * `require_approval` / `approval_allowed_users` settings are the authoritative
 * gate -- they block a pipeline before any step is scheduled -- but they live
 * in the server's database, where nothing in this repository can assert them.
 * The allowlist below lives in the extension's deployed image instead. A
 * branch cannot edit it into permitting itself, because the extension serves
 * the image it was deployed from rather than the branch under test.
 */

import type { Pipeline } from "#src/schemas.ts";

/**
 * Forge logins permitted to start a pipeline.
 *
 * These are GitHub logins as they appear in a webhook's `sender`, not git
 * commit identities: work pushed with the GitHub App's token is authored by
 * `CI Bot <ci@sjer.red>` but sent by the app's bot user, and it is the sender
 * that is authenticated. App bots carry the `[bot]` suffix in this form.
 */
export const TRUSTED_ACTORS: readonly string[] = [
  "shepherdjerred",
  // The repository's own GitHub App: release commits, version pin commit-back,
  // and the CI image refresh lanes all push under this identity.
  "long-summer-intern[bot]",
  // Mend-hosted Renovate. Dependency pull requests must still build.
  "renovate[bot]",
];

export type AuthorizationResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Decide whether a pipeline may be generated.
 *
 * Both identities Woodpecker reports have to be trusted, because they answer
 * different questions and a pull request can separate them. `author` is the
 * account that opened the pull request; `sender` is the account whose action
 * produced this particular event. Checking only `author` would let an
 * untrusted account drive new commits into a trusted account's pull request;
 * checking only `sender` would accept an untrusted pull request re-triggered
 * by a trusted one.
 *
 * `sender` is checked only when Woodpecker actually reports one. A webhook
 * always carries both, so the pull request case above is fully covered; but
 * pipelines Woodpecker creates itself fill in only what they know. A manual
 * trigger records the signed-in user who pressed the button as `author` and
 * leaves `sender` empty, and demanding a sender there would refuse every
 * manual build. A cron records neither, which is why it is refused: the empty
 * string is not a trusted actor. That refusal matters, because Woodpecker's
 * own approval gate exempts cron and manual pipelines entirely, leaving this
 * the only thing in front of a cron -- and recurring work in this repository
 * belongs to Temporal, so a cron reaching here is something nobody reviewed.
 *
 * Forks are refused outright rather than allowlisted. A fork's pull request is
 * the one path by which an account with no write access reaches this pipeline,
 * and the owner works from branches in the repository itself, so the rule
 * costs nothing it needs to permit.
 */
export function authorizePipeline(pipeline: Pipeline): AuthorizationResult {
  if (pipeline.from_fork) {
    return { allowed: false, reason: "pipeline originates from a fork" };
  }

  const trusted = new Set(TRUSTED_ACTORS);
  if (!trusted.has(pipeline.author)) {
    return { allowed: false, reason: "pipeline author is not a trusted actor" };
  }
  return pipeline.sender !== "" && !trusted.has(pipeline.sender)
    ? { allowed: false, reason: "pipeline sender is not a trusted actor" }
    : { allowed: true };
}
