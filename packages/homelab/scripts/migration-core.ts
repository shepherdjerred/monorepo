export type VeleroCommand = "inspect" | "delete-r2" | "delete-all";
export type R2Target = "backups" | "zfs" | "all";
export type VeleroOptions = {
  readonly command: VeleroCommand;
  readonly apply: boolean;
  readonly yes: boolean;
  readonly target?: R2Target;
};

export function setChartVersion(source: string, version: string): string {
  const withVersion = source.replace(/^version:.*$/m, `version: ${version}`);
  return withVersion.replace(/^appVersion:.*$/m, `appVersion: ${version}`);
}

export function chartName(chartPath: string): string {
  return chartPath.replace(/\/$/, "").split("/").at(-1) ?? chartPath;
}

export function parseVeleroArguments(
  rawArguments: readonly string[],
): VeleroOptions {
  const command = rawArguments[0];
  if (
    command !== "inspect" &&
    command !== "delete-r2" &&
    command !== "delete-all"
  ) {
    throw new Error(
      "Usage: bun run velero:backups -- inspect|delete-r2|delete-all [--apply] [--yes]",
    );
  }
  let apply = false;
  let yes = false;
  let target: R2Target | undefined;
  for (let index = 1; index < rawArguments.length; index += 1) {
    const flag = rawArguments[index];
    switch (flag) {
      case "--apply":
        apply = true;
        break;
      case "--yes":
        yes = true;
        break;
      case "--target": {
        const value = rawArguments[index + 1];
        if (value !== "backups" && value !== "zfs" && value !== "all") {
          throw new Error("--target requires backups, zfs, or all");
        }
        target = value;
        index += 1;
        break;
      }
      case undefined:
        throw new Error("Missing option");
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (command === "delete-r2" && target === undefined) {
    throw new Error("delete-r2 requires --target backups, zfs, or all");
  }
  if (command !== "delete-r2" && target !== undefined) {
    throw new Error("--target is only valid with delete-r2");
  }
  return target === undefined
    ? { command, apply, yes }
    : { command, apply, yes, target };
}
