import { z } from "zod";

export function parseTimeout(value: string): number {
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
    throw new Error("--timeout requires a duration such as 30m or 2h");
  return z
    .number()
    .int()
    .positive()
    .max(2_147_483_647)
    .parse(Number(match[1]) * multiplier);
}
