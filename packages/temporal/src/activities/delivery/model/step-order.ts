import { ApplicationFailure } from "@temporalio/activity";
import { stepStageKey } from "@shepherdjerred/delivery/model-contract";
import type { ModelStep } from "#lib/delivery/model/recipe.ts";

/** A compound sub-recipe's key prefix (`sub<n>-`); a single recipe has none. */
const SUB_RECIPE_PREFIX = /^sub\d+-/u;

/** What each backend-dependent Application step does against its backend. */
const BACKEND_EFFECTS = {
  "static-site": "activate a frontend archive",
  archive: "publish plugin settings",
  "forum-bundle": "migrate the forum",
} as const;

/**
 * A site archive, plugin archive or forum release acts against the backend
 * its own Application serves, so it runs only after that Application's sync
 * (T3): a site's digest dependency names the synced backend image, plugin
 * settings point at the synced backend, and a forum release waits for the
 * sync request and release Job only that sync creates. The recipe contract
 * orders apply-safety before sync but not these steps after it, so a recipe
 * that orders one first is refused, before any intent or effect.
 */
export function requireSyncedBefore(
  steps: readonly ModelStep[],
  key: string,
  kind: keyof typeof BACKEND_EFFECTS,
) {
  const prefix = SUB_RECIPE_PREFIX.exec(key)?.[0] ?? "";
  const keys = steps.map((step) => step.key);
  const sync = keys.indexOf(`${prefix}${stepStageKey("step", "sync")}`);
  if (sync === -1 || sync > keys.indexOf(key))
    throw ApplicationFailure.nonRetryable(
      `Step ${key} would ${BACKEND_EFFECTS[kind]} before its Application synced; the recipe must order sync first`,
      "DeliveryModelStepOrder",
    );
}
