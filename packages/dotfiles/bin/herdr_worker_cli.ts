// Shared CLI entrypoint and JSONL event helpers for detached Herdr workers
// (`herdr-new-worktree` and `herdr-takeover`).
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type WorkerOutcomeRecord = {
  ok: boolean;
  ms: number;
  error: string | null;
};

export function describeWorkerError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function printRecentWorkerEvents(
  eventsPath: string,
  isOkLine: (parsed: unknown) => boolean,
): Promise<number> {
  let contents: string;
  try {
    contents = await readFile(eventsPath, "utf8");
  } catch {
    console.log(`No runs recorded in ${eventsPath}.`);
    return 0;
  }
  let lastOk = true;
  for (const line of contents.split("\n").filter(Boolean).slice(-10)) {
    lastOk = isOkLine(JSON.parse(line));
    console.log(line);
  }
  return lastOk ? 0 : 1;
}

export async function recordWorkerEvent(
  eventsPath: string,
  event: WorkerOutcomeRecord,
  startedMs: number,
): Promise<void> {
  event.ms = Date.now() - startedMs;
  try {
    await mkdir(path.dirname(eventsPath), { recursive: true, mode: 0o700 });
    await appendFile(eventsPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch (error) {
    event.ok = false;
    const writeFailure = `events.jsonl not written: ${describeWorkerError(error)}`;
    event.error =
      event.error === null ? writeFailure : `${event.error}; ${writeFailure}`;
  }
}

export type WorkerCliConfig = {
  readonly argv: readonly string[];
  readonly binaryName: string;
  readonly dialogLabel: string;
  readonly requestVariable: string;
  readonly eventsPath: string;
  readonly onStatus: () => Promise<number>;
  readonly onRun: (requestJson: string) => Promise<number>;
};

export async function dispatchWorkerCli(
  config: WorkerCliConfig,
): Promise<number> {
  const [first] = config.argv;
  if (first === "--status" && config.argv.length === 1) {
    return config.onStatus();
  }
  const envPayload =
    first === "--request-env" && config.argv.length === 1
      ? Bun.env[config.requestVariable]
      : undefined;
  if (envPayload !== undefined) {
    return config.onRun(envPayload);
  }
  if (
    first === undefined ||
    first === "--help" ||
    first === "--request-env" ||
    config.argv.length !== 1
  ) {
    console.error(
      `Usage: ${config.binaryName} '<request json>' | --request-env | --status\nStarted by the Herdr ${config.dialogLabel} dialog (--request-env reads ${config.requestVariable}); results go to ${config.eventsPath}`,
    );
    return 2;
  }
  return config.onRun(first);
}
