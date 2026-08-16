import { stat } from "node:fs/promises";
import { z } from "zod";
import {
  defaultHistoryRuntimePaths,
  type HistoryRuntimePaths,
} from "./paths.ts";

export const HistoryDaemonStateSchema = z.object({
  pid: z.number(),
  startedAt: z.string(),
  intervalSeconds: z.number(),
  lastScanAt: z.string().nullable(),
});
export type HistoryDaemonState = z.infer<typeof HistoryDaemonStateSchema>;

export const HistoryDaemonStatusSchema = z.object({
  pid: z.number(),
  startedAt: z.string(),
  intervalSeconds: z.number(),
  lastScanAt: z.string().nullable(),
  sources: z.array(
    z.object({
      source: z.string(),
      label: z.string(),
      available: z.boolean(),
      indexedDocuments: z.number(),
      lastScanAt: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
export type HistoryDaemonStatus = z.infer<typeof HistoryDaemonStatusSchema>;

export const HistoryDaemonResponseSchema = z.object({ ok: z.boolean() });

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function historyDaemonRequest<T extends z.ZodType>(
  runtimePaths: HistoryRuntimePaths = defaultHistoryRuntimePaths(),
  schema: T,
  endpoint: string,
): Promise<z.infer<T>> {
  if (!(await pathExists(runtimePaths.socket))) {
    throw new Error(
      "History daemon is not running. Install and start it with `toolkit history daemon install`.",
    );
  }
  let response: Response;
  try {
    response = await fetch(`http://history${endpoint}`, {
      unix: runtimePaths.socket,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach the history daemon (${message}); inspect ${runtimePaths.logsDir} and run ` +
        "`toolkit history daemon stop` before restarting it.",
      { cause: error },
    );
  }
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      error.success
        ? error.data.error
        : `History daemon error (HTTP ${String(response.status)})`,
    );
  }
  return schema.parse(body);
}
