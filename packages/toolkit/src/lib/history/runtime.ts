import type { HistoryRuntimeRef } from "./types.ts";

export function currentHistoryRuntimes(): readonly HistoryRuntimeRef[] {
  return [
    { source: "conductor" as const, value: Bun.env["CONDUCTOR_SESSION_ID"] },
    { source: "codex" as const, value: Bun.env["CODEX_THREAD_ID"] },
  ].flatMap(({ source, value }) =>
    value === undefined || value.length === 0
      ? []
      : [{ source, runtimeId: value }],
  );
}
