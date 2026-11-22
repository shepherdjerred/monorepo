import { z } from "zod/v4";
import { botCloneCacheDir } from "#activities/bot-clone.ts";
import {
  runCommand as defaultRunCommand,
  type GitCommandRunner,
} from "#activities/scout/scout-season-refresh-git.ts";
import { isReportRemediationEnabled } from "#config/report-remediation.ts";
import type { QueueLivenessCheck } from "./scout-queue-window-liveness.ts";
import type { QueueWindowsReport } from "./scout-queue-windows-report.ts";

const QUEUE_WINDOWS_RELATIVE_PATH =
  "packages/scout-for-lol/packages/data/src/model/competitions/queue-windows.json";

const EditableQueueWindowSchema = z.strictObject({
  start: z.string(),
  end: z.string().nullable(),
  source: z.enum(["manual", "observed"]).optional(),
  note: z.string().optional(),
});

const EditableQueueWindowsFileSchema = z.strictObject({
  queues: z.record(z.string(), z.array(EditableQueueWindowSchema)),
});

export type HttpsReachabilityCheck = (url: string) => Promise<boolean>;

export function isValidIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

async function defaultVerifyHttpsSourceReachable(
  url: string,
): Promise<boolean> {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    return false;
  }
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function hasReachableHttpsSource(
  sources: readonly string[],
  verifyHttps: HttpsReachabilityCheck,
): Promise<boolean> {
  for (const source of sources) {
    if (!URL.canParse(source)) {
      continue;
    }
    if (new URL(source).protocol !== "https:") {
      continue;
    }
    if (await verifyHttps(source)) {
      return true;
    }
  }
  return false;
}

export async function applyConfirmedEndedQueueCloses(input: {
  queueWindowsFile: string;
  report: QueueWindowsReport;
  livenessChecks: readonly QueueLivenessCheck[];
  today?: string;
  isRemediationEnabled?: () => Promise<boolean>;
  verifyHttpsSourceReachable?: HttpsReachabilityCheck;
}): Promise<QueueWindowsReport["edits"]> {
  const candidateChecks = input.livenessChecks.filter(
    (check) =>
      check.status === "ended" &&
      check.errorClass === undefined &&
      check.endedOn !== undefined,
  );
  if (candidateChecks.length === 0) {
    return [];
  }

  const checkEnabled =
    input.isRemediationEnabled ?? (() => isReportRemediationEnabled());
  if (!(await checkEnabled())) {
    return [];
  }

  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const verifyHttps =
    input.verifyHttpsSourceReachable ?? defaultVerifyHttpsSourceReachable;
  const parsedFile = EditableQueueWindowsFileSchema.parse(
    await Bun.file(input.queueWindowsFile).json(),
  );
  const appliedEdits: QueueWindowsReport["edits"] = [];

  for (const check of candidateChecks) {
    const endedOn = check.endedOn;
    if (endedOn === undefined || !isValidIsoCalendarDate(endedOn)) {
      continue;
    }
    const queueWindows = parsedFile.queues[check.queue];
    const openWindow = queueWindows?.at(-1);
    if (openWindow?.end !== null) {
      continue;
    }
    if (endedOn < openWindow.start || endedOn > today) {
      continue;
    }
    if (!(await hasReachableHttpsSource(check.sources, verifyHttps))) {
      continue;
    }

    openWindow.end = endedOn;
    const edit: QueueWindowsReport["edits"][number] = {
      queue: check.queue,
      kind: "close",
      date: endedOn,
      message: `LLM web-search confirmed ended (${check.rationale}; sources: ${check.sources.join(", ")})`,
    };
    input.report.edits.push(edit);
    appliedEdits.push(edit);
  }

  if (appliedEdits.length > 0) {
    await Bun.write(
      input.queueWindowsFile,
      `${JSON.stringify(parsedFile, null, 2)}\n`,
    );
  }

  return appliedEdits;
}

export async function validateScoutQueueWindowsInRepo(
  repoDir: string,
  commandRunner: GitCommandRunner = defaultRunCommand,
): Promise<void> {
  const commandEnv = {
    ENVIRONMENT: undefined,
    BUN_INSTALL_CACHE_DIR: botCloneCacheDir(repoDir),
  };
  await commandRunner(
    [
      "bunx",
      "--no-install",
      "prettier",
      "--write",
      "--",
      QUEUE_WINDOWS_RELATIVE_PATH,
    ],
    { cwd: repoDir, env: commandEnv },
  );
  await commandRunner(
    [
      "bun",
      "run",
      "test",
      "--",
      "src/model/competitions/queue-windows.schema.test.ts",
      "src/model/competitions/queue-window-drift.test.ts",
    ],
    {
      cwd: `${repoDir}/packages/scout-for-lol/packages/data`,
      env: commandEnv,
    },
  );
}
