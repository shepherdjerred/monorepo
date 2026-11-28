export function parseTimeout(value: string, option = "--timeout"): number {
  const match = /^(\d+(?:\.\d+)?)(ms|[smh])$/.exec(value);
  const unit = match?.[2];
  const multiplier =
    unit === "ms"
      ? 1
      : unit === "s"
        ? 1000
        : unit === "m"
          ? 60_000
          : unit === "h"
            ? 3_600_000
            : null;
  if (match === null || multiplier === null)
    throw new Error(`${option} requires a duration such as 30m or 2h`);
  const ms = Number(match[1]) * multiplier;
  if (!Number.isInteger(ms) || ms <= 0 || ms > 2_147_483_647) {
    throw new Error(
      `${option} must be a positive duration between 1ms and 24d`,
    );
  }
  return ms;
}

/** Print `usage` and return true when the arguments ask for help. */
export function printHelpIfRequested(
  args: readonly string[],
  usage: string,
): boolean {
  if (!args.includes("--help") && !args.includes("-h")) return false;
  console.log(usage);
  return true;
}
