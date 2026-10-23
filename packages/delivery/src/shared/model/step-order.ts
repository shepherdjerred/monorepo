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
 * Settlement and recovery read one site activation per release
 * (`siteReleaseOf`, `specializedStageKey`), while the executor runs every
 * static-site step it is given. A recipe therefore holds at most one
 * static-site step across its Applications, compound sub-recipes included.
 */
export const ONE_SITE_STEP =
  "A recipe activates at most one static-site step across its Applications; settlement proves exactly one site activation per release";

/** Whether these Application steps hold more than one static-site step. */
export function extraSiteSteps(steps: readonly { kind: string }[]) {
  return steps.filter((step) => step.kind === "static-site").length > 1;
}
