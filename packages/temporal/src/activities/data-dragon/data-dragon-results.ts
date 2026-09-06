import type {
  DataDragonUpdateInput,
  DataDragonUpdateResult,
} from "#shared/data-dragon-types.ts";
import { recordRun } from "./data-dragon-metrics.ts";

export function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: "scout-data-dragon-update",
      ...fields,
    }),
  );
}

export function noDiffResult(
  input: DataDragonUpdateInput,
  durationSeconds: number,
  message: string,
  options: {
    reason?: "no-diff" | "formatting-only-diff";
    formattingOnlyFiles?: string[];
  } = {},
): DataDragonUpdateResult {
  const reason = options.reason ?? "no-diff";
  recordRun({
    mode: input.mode,
    outcome: "success",
    reason,
    currentVersion: input.currentVersion,
    latestVersion: input.latestVersion,
    changedFiles: 0,
    durationSeconds,
  });
  jsonLog("info", message, { ...input, durationSeconds });
  return {
    ...input,
    changedFiles: [],
    branchName: undefined,
    commitHash: undefined,
    prUrl: undefined,
    outcome: "skipped",
    reason,
    ...(options.formattingOnlyFiles !== undefined &&
    options.formattingOnlyFiles.length > 0
      ? { formattingOnlyFiles: options.formattingOnlyFiles }
      : {}),
  };
}
