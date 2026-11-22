import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import type { MonorepoFacet } from "@shepherdjerred/ops-model/facets.ts";

const CI_HANDOFF_BUCKET = "ci-handoff";
const DIAGNOSTICS_SUFFIX = "/diagnostics-verify.json";
const DIAGNOSTICS_CACHE_TTL_MS = 15 * 60_000;
const SEVEN_DAYS_MS = 7 * 86_400_000;
const MAX_RUNS_TO_READ = 15;

const VerifyDiagnosticsSchema = z
  .object({
    turbo: z
      .array(
        z
          .object({
            tasks: z
              .array(
                z
                  .object({
                    taskId: z.string().min(1),
                    cache: z
                      .object({ status: z.enum(["HIT", "MISS", "BYPASS"]) })
                      .loose(),
                    execution: z
                      .object({
                        startTime: z.number().nonnegative(),
                        endTime: z.number().nonnegative().optional(),
                      })
                      .loose()
                      .optional(),
                  })
                  .loose(),
              )
              .default([]),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();

export type CompactTaskRecord = {
  taskId: string;
  status: "HIT" | "MISS" | "BYPASS";
  durationMs: number;
};

export type DiagnosticsSummary = {
  verifyRunsAnalyzed: number;
  turboHitRatio7d: number | null;
  turboSavedHours7d: number | null;
  expensiveTasks: MonorepoFacet["expensiveTasks"];
  byPackage: Map<string, { hitRatio: number | null; medianMs: number | null }>;
};

type TaskAccumulator = {
  hits: number;
  misses: number;
  missDurationsMs: number[];
  allDurationsMs: number[];
};

const compactedRunByKey = new Map<string, CompactTaskRecord[]>();
let cachedDiagnostics:
  (DiagnosticsSummary & { expiresAtMs: number }) | undefined;

export function clearDiagnosticsCache(): void {
  compactedRunByKey.clear();
  cachedDiagnostics = undefined;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? 0) + upper) / 2;
}

function splitTaskId(taskId: string): { packageName: string; task: string } {
  const idx = taskId.lastIndexOf("#");
  if (idx <= 0) {
    return {
      packageName: "(root)",
      task: idx === 0 ? taskId.slice(1) : taskId,
    };
  }
  return { packageName: taskId.slice(0, idx), task: taskId.slice(idx + 1) };
}

function accumulateTasks(runs: readonly (readonly CompactTaskRecord[])[]) {
  const taskStats = new Map<string, TaskAccumulator>();
  let totalHits = 0;
  let totalMisses = 0;

  for (const tasks of runs) {
    for (const record of tasks) {
      let acc = taskStats.get(record.taskId);
      if (acc === undefined) {
        acc = { hits: 0, misses: 0, missDurationsMs: [], allDurationsMs: [] };
        taskStats.set(record.taskId, acc);
      }
      acc.allDurationsMs.push(record.durationMs);
      if (record.status === "HIT") {
        acc.hits += 1;
        totalHits += 1;
      } else if (record.status === "MISS") {
        acc.misses += 1;
        totalMisses += 1;
        acc.missDurationsMs.push(record.durationMs);
      }
    }
  }
  return { taskStats, totalHits, totalMisses };
}

function buildExpensiveAndPackageStats(
  taskStats: ReadonlyMap<string, TaskAccumulator>,
) {
  let savedMsTotal = 0;
  const expensiveTasks: MonorepoFacet["expensiveTasks"] = [];
  const pkgAcc = new Map<
    string,
    { hits: number; misses: number; durationsMs: number[] }
  >();

  for (const [taskId, acc] of taskStats.entries()) {
    const { packageName, task } = splitTaskId(taskId);
    const medianMissMs = Math.round(median(acc.missDurationsMs));
    savedMsTotal += acc.hits * medianMissMs;
    const totalMissMs = acc.missDurationsMs.reduce((sum, v) => sum + v, 0);
    const count = acc.hits + acc.misses;
    if (acc.misses > 0 && count > 0) {
      expensiveTasks.push({
        taskId,
        packageName,
        task,
        hits: acc.hits,
        misses: acc.misses,
        hitRatio: Math.round((acc.hits / count) * 100) / 100,
        medianMissMs,
        totalMissMinutes: Math.round((totalMissMs / 60_000) * 100) / 100,
      });
    }
    const p = pkgAcc.get(packageName) ?? {
      hits: 0,
      misses: 0,
      durationsMs: [],
    };
    p.hits += acc.hits;
    p.misses += acc.misses;
    p.durationsMs.push(...acc.allDurationsMs);
    pkgAcc.set(packageName, p);
  }

  expensiveTasks.sort(
    (a, b) =>
      b.totalMissMinutes - a.totalMissMinutes ||
      b.medianMissMs - a.medianMissMs ||
      a.taskId.localeCompare(b.taskId),
  );

  const byPackage = new Map<
    string,
    { hitRatio: number | null; medianMs: number | null }
  >();
  for (const [pkgName, p] of pkgAcc.entries()) {
    const total = p.hits + p.misses;
    byPackage.set(pkgName, {
      hitRatio: total > 0 ? Math.round((p.hits / total) * 1000) / 1000 : null,
      medianMs:
        p.durationsMs.length > 0 ? Math.round(median(p.durationsMs)) : null,
    });
  }
  return { savedMsTotal, expensiveTasks, byPackage };
}

export function summarizeDiagnosticsRuns(
  runs: readonly (readonly CompactTaskRecord[])[],
): DiagnosticsSummary {
  if (runs.length === 0) {
    return {
      verifyRunsAnalyzed: 0,
      turboHitRatio7d: null,
      turboSavedHours7d: null,
      expensiveTasks: [],
      byPackage: new Map(),
    };
  }
  const { taskStats, totalHits, totalMisses } = accumulateTasks(runs);
  const totalCounted = totalHits + totalMisses;
  const turboHitRatio7d =
    totalCounted > 0
      ? Math.round((totalHits / totalCounted) * 1000) / 1000
      : null;
  const { savedMsTotal, expensiveTasks, byPackage } =
    buildExpensiveAndPackageStats(taskStats);

  return {
    verifyRunsAnalyzed: runs.length,
    turboHitRatio7d,
    turboSavedHours7d: Math.round((savedMsTotal / 3_600_000) * 100) / 100,
    expensiveTasks: expensiveTasks.slice(0, 15),
    byPackage,
  };
}

export function compactVerifyDiagnosticsJson(
  rawJson: unknown,
): CompactTaskRecord[] {
  const parsed = VerifyDiagnosticsSchema.safeParse(rawJson);
  if (!parsed.success) {
    return [];
  }
  return parsed.data.turbo.flatMap((run) =>
    run.tasks.map((task): CompactTaskRecord => {
      const end = task.execution?.endTime;
      const start = task.execution?.startTime;
      const durationMs =
        end !== undefined && start !== undefined ? Math.max(0, end - start) : 0;
      return { taskId: task.taskId, status: task.cache.status, durationMs };
    }),
  );
}

function defaultS3Client(): S3Client | undefined {
  const endpoint = (Bun.env["S3_ENDPOINT"] ?? "").trim();
  const accessKeyId = (Bun.env["AWS_ACCESS_KEY_ID"] ?? "").trim();
  const secretAccessKey = (Bun.env["AWS_SECRET_ACCESS_KEY"] ?? "").trim();
  if (endpoint === "" || accessKeyId === "" || secretAccessKey === "") {
    return undefined;
  }
  const sessionToken = (Bun.env["AWS_SESSION_TOKEN"] ?? "").trim();
  return new S3Client({
    endpoint,
    region: Bun.env["S3_REGION"] ?? "us-east-1",
    forcePathStyle: (Bun.env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
    credentials:
      sessionToken === ""
        ? { accessKeyId, secretAccessKey }
        : { accessKeyId, secretAccessKey, sessionToken },
  });
}

async function readOrCompactRun(
  client: S3Client,
  key: string,
): Promise<CompactTaskRecord[] | undefined> {
  const cached = compactedRunByKey.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const obj = await client.send(
    new GetObjectCommand({ Bucket: CI_HANDOFF_BUCKET, Key: key }),
    { abortSignal: AbortSignal.timeout(8000) },
  );
  if (obj.Body === undefined) {
    return undefined;
  }
  const compact = compactVerifyDiagnosticsJson(
    JSON.parse(await obj.Body.transformToString()),
  );
  compactedRunByKey.set(key, compact);
  return compact;
}

export async function fetchRecentDiagnostics(
  s3Client: S3Client | undefined,
  now: Date,
): Promise<DiagnosticsSummary> {
  const nowMs = now.getTime();
  if (
    cachedDiagnostics !== undefined &&
    nowMs < cachedDiagnostics.expiresAtMs
  ) {
    return cachedDiagnostics;
  }
  const client = s3Client ?? defaultS3Client();
  if (client === undefined) {
    return summarizeDiagnosticsRuns([]);
  }
  try {
    const cutoffMs = nowMs - SEVEN_DAYS_MS;
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: CI_HANDOFF_BUCKET, MaxKeys: 1000 }),
      { abortSignal: AbortSignal.timeout(8000) },
    );
    const matchingKeys = (listed.Contents ?? [])
      .filter(
        (obj) =>
          obj.Key?.endsWith(DIAGNOSTICS_SUFFIX) === true &&
          (obj.LastModified === undefined ||
            obj.LastModified.getTime() >= cutoffMs),
      )
      .sort(
        (a, b) =>
          (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0),
      )
      .slice(0, MAX_RUNS_TO_READ)
      .flatMap((obj) => (obj.Key === undefined ? [] : [obj.Key]));

    const runs: CompactTaskRecord[][] = [];
    for (const key of matchingKeys) {
      const compact = await readOrCompactRun(client, key);
      if (compact !== undefined && compact.length > 0) {
        runs.push(compact);
      }
    }
    const summary = summarizeDiagnosticsRuns(runs);
    cachedDiagnostics = {
      ...summary,
      expiresAtMs: nowMs + DIAGNOSTICS_CACHE_TTL_MS,
    };
    return summary;
  } catch {
    return summarizeDiagnosticsRuns([]);
  }
}
