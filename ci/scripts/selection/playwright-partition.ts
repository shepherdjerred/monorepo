import type { PlaywrightSelection } from "./playwright-targets.ts";

const MEDIA_PACKAGE = "@shepherdjerred/media";

export type PlaywrightPartition = "all" | "primary" | "media";

export function parsePlaywrightPartition(
  args: readonly string[],
): PlaywrightPartition {
  if (args.length === 0) return "all";
  const [option, partition] = args;
  if (
    option === "--partition" &&
    args.length === 2 &&
    (partition === "primary" || partition === "media")
  ) {
    return partition;
  }
  throw new Error("Usage: run-playwright.ts [--partition primary|media]");
}

export function partitionPlaywrightSelection(
  selection: PlaywrightSelection,
  partition: PlaywrightPartition,
): PlaywrightSelection {
  if (partition === "all") return selection;
  const isMediaPartition = partition === "media";
  const targets = selection.targets.filter(
    (target) => (target.package === MEDIA_PACKAGE) === isMediaPartition,
  );
  return {
    ...selection,
    targets,
    reasons: Object.fromEntries(
      targets.map((target) => [
        target.package,
        selection.reasons[target.package] ?? [],
      ]),
    ),
  };
}
