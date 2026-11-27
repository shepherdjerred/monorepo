import type { AuthorizationResult } from "#src/authorization.ts";
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
 * The accounts whose proposals write main's cache: the owner and the agent
 * account his coding sessions push as.
 *
 * Deliberately not derived from `OWNER_CONTROLLED_ACTORS`. Admitting an
 * account to run CI must not also hand it write access to the entries main
 * loads; that is a separate decision, made here.
 */
export const CACHE_TRUSTED_ACTORS: readonly string[] = [
  "shepherdjerred",
  "derrej",
];

/**
 * Decide which cache a pipeline joins.
 *
 * Default-branch work by any admitted actor joins the trusted cache. A
 * proposal -- a pull request, or an owner's canary benchmark -- joins it only
 * when all of these hold:
 *
 * - `authorizePipeline` admitted it as owner-controlled. That result reads
 *   only the author and sender logins and the fork flag, which Woodpecker
 *   takes from the forge's webhook and signs into the request; a branch name,
 *   commit message or pull request text cannot change it.
 * - the event is not credentialless hosted automation;
 * - the head repository is the base repository;
 * - neither author nor sender is a GitHub App;
 * - the author, and the sender when Woodpecker reports one, are each in
 *   `CACHE_TRUSTED_ACTORS`.
 *
 * Trust follows the event's sender, not whoever pushed the head commit:
 * Woodpecker does not report the pusher.
 *
 * A refused actor or a credentialless event never reaches a cache grant, so
 * both resolve to `pull-request` whatever the branch.
 */
export function cacheTrustDomain(input: {
  /** A pull request or canary run rather than default-branch work. */
  readonly proposal: boolean;
  /** The event received the credentialless hosted-automation plan. */
  readonly credentialless: boolean;
  /** `authorizePipeline`'s result for this pipeline. */
  readonly authorization: AuthorizationResult;
  readonly pipeline: Pick<Pipeline, "author" | "sender" | "from_fork">;
}): CacheTrustDomain {
  const { authorization, pipeline } = input;
  if (!authorization.allowed || input.credentialless) return "pull-request";
  if (!input.proposal) return "trusted";
  // GitHub App logins carry this suffix, which GitHub reserves: a user login
  // holds only alphanumerics and hyphens, so no person's account can claim it.
  const app = [pipeline.author, pipeline.sender].some((login) =>
    login.endsWith("[bot]"),
  );
  if (app || pipeline.from_fork) return "pull-request";
  const trusted = new Set(CACHE_TRUSTED_ACTORS);
  return authorization.actorClass === "owner-controlled" &&
    trusted.has(pipeline.author) &&
    (pipeline.sender === "" || trusted.has(pipeline.sender))
    ? "trusted"
    : "pull-request";
}

/** The formatter-result volume verify mounts: `woodpecker-format-<scope>`. */
export type FormatCacheScope = "main" | "pr" | "none";

/**
 * Formatter results let verify skip files Prettier already passed, and they
 * are written by the verify step itself, so they are as trusted as the code
 * that wrote them. Isolated proposals share the `pr` volume. A trusted
 * proposal must not read it, because a pass planted there would become a
 * Turbo entry main loads. `ci-pod-guard` admits the `main` volume only for
 * default-branch verify, so a trusted proposal mounts none and runs Prettier
 * in full.
 */
export function formatCacheScope(input: {
  readonly main: boolean;
  readonly trustDomain: CacheTrustDomain;
}): FormatCacheScope {
  if (input.trustDomain === "pull-request") return "pr";
  return input.main ? "main" : "none";
}
