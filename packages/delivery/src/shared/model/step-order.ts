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
