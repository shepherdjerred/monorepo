/**
 * Issues for minecraft-upgrade steps on the wrong side of the sync: a
 * verified-restore upgrade preserves the world before the sync switches its
 * image; a retained-volume restart is read back after it.
 */
export function misplacedUpgrades(
  steps: readonly { kind: string; releaseMode?: string }[],
) {
  const sync = steps.findIndex((step) => step.kind === "sync");
  return steps.flatMap((step, index) =>
    step.kind === "minecraft-upgrade" &&
    index < sync !== (step.releaseMode === "verified-restore")
      ? [
          {
            code: "custom" as const,
            path: ["steps", index],
            message:
              "A verified-restore minecraft-upgrade runs before sync; a retained-volume restart runs after it",
          },
        ]
      : [],
  );
}

/**
 * Settlement, recovery and Forum candidate validation each read one
 * occurrence of these steps per release (`siteReleaseOf`,
 * `specializedStageKey`, `forumReleaseOf`, `stepApplicationOf`), while the
 * executor runs every step it is given. A recipe therefore holds at most one
 * of each across its Applications, compound sub-recipes included.
 */
export const ONE_SITE_STEP =
  "A recipe activates at most one static-site step across its Applications; settlement proves exactly one site activation per release";
export const ONE_FORUM_BUNDLE =
  "A recipe migrates at most one Forum database: it holds at most one forum-bundle step across its Applications, because candidate validation and the baseline freeze read one Forum release per deployment";

const SINGLE_STEPS: Readonly<Record<string, string>> = {
  "static-site": ONE_SITE_STEP,
  "forum-bundle": ONE_FORUM_BUNDLE,
};

/** The refusal for each single-occurrence step kind these Application steps repeat. */
export function repeatedSingleSteps(steps: readonly { kind: string }[]) {
  return Object.entries(SINGLE_STEPS).flatMap(([kind, message]) =>
    steps.filter((step) => step.kind === kind).length > 1 ? [message] : [],
  );
}
