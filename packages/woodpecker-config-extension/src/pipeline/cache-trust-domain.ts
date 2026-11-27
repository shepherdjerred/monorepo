import { authorizePipeline } from "#src/authorization.ts";
import type { Pipeline } from "#src/schemas.ts";

/**
 * Which remote build cache a pipeline's Turbo, Gradle and sccache steps join.
 *
 * `trusted` is the shared cache: the `monorepo` Turbo team signed with the
 * trusted key, and the read-write `ci-main` WebDAV user. `pull-request` is the
 * isolated one: the `monorepo-pull-request` team, which reads `monorepo` on a
 * miss without writing back, and the read-only `ci-pull-request` user.
 */
export type CacheTrustDomain = "trusted" | "pull-request";

/**
 * Decide which cache a pipeline joins.
 *
 * Default-branch work by any admitted actor joins the trusted cache. A
 * proposal -- a pull request, or an owner's canary benchmark -- joins it only
 * when every route by which someone else's code could write entries that main
 * later loads is ruled out. All four conditions are needed:
 *
 * - `authorizePipeline` classes the actor owner-controlled. It reads only the
 *   author and sender logins and the fork flag, which Woodpecker takes from
 *   the forge's webhook and signs into the request; a branch name, commit
 *   message or pull request text cannot change it.
 * - the event is not credentialless hosted automation;
 * - the head repository is the base repository;
 * - neither author nor sender is a GitHub App. Renovate proposes third-party
 *   code, and the owner's Apps publish automation output; both stay isolated.
 *
 * A refused actor or a credentialless event never reaches a cache grant, so
 * both resolve to `pull-request` whatever the branch.
 */
export function cacheTrustDomain(input: {
  /** A pull request or canary run rather than default-branch work. */
  readonly proposal: boolean;
  /** The event received the credentialless hosted-automation plan. */
  readonly credentialless: boolean;
  readonly pipeline: Pipeline;
}): CacheTrustDomain {
  const { pipeline } = input;
  const authorization = authorizePipeline(pipeline);
  if (!authorization.allowed || input.credentialless) return "pull-request";
  if (!input.proposal) return "trusted";
  // GitHub App logins carry this suffix, which GitHub reserves: a user login
  // holds only alphanumerics and hyphens, so no person's account can claim it.
  const app = [pipeline.author, pipeline.sender].some((login) =>
    login.endsWith("[bot]"),
  );
  if (app || pipeline.from_fork) return "pull-request";
  return authorization.actorClass === "owner-controlled"
    ? "trusted"
    : "pull-request";
}
