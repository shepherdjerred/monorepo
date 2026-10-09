import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const Timestamp = z.number().int().nonnegative();
const Name = z
  .string()
  .regex(/^[\w@./:#-]+$/u)
  .max(300);
const Hash = z
  .string()
  .regex(/^[a-f\d]+$/u)
  .max(128);
const Execution = z.object({
  startTime: Timestamp,
  endTime: Timestamp.optional(),
  exitCode: z.number().int().nullable().optional(),
});

// Zod strips every unlisted field at every level. In particular, summaries
// contain environment values, commands and logs which must never be retained.
export const TurboDiagnosticSchema = z.object({
  id: Name,
  turboVersion: z.string().regex(/^[\w.+-]+$/u),
  execution: Execution.extend({
    success: Timestamp,
    failed: Timestamp,
    cached: Timestamp,
    attempted: Timestamp,
  }),
  tasks: z
    .array(
      z.object({
        taskId: Name,
        hash: Hash,
        hashOfExternalDependencies: Hash.optional(),
        cache: z.object({
          local: z.boolean(),
          remote: z.boolean(),
          status: z.enum(["HIT", "MISS", "BYPASS"]),
          timeSaved: z.number().nonnegative(),
        }),
        dependencies: z.array(Name),
        execution: Execution.optional(),
      }),
    )
    .max(10_000),
});

const BrowserSelectionSchema = z.object({
  base: z
    .string()
    .regex(/^[a-f\d]{40}$/u)
    .nullable(),
  mode: z.enum(["all", "selected"]),
  targets: z.array(z.object({ package: Name, cache: Name })),
});

export const TaskDiagnosticsSchema = z.object({
  version: z.literal(1),
  pipeline: z.string().regex(/^\d+$/u),
  commit: z.string().regex(/^[a-f\d]{40}$/u),
  workflow: z.enum(["verify", "playwright-e2e"]),
  startedAt: Timestamp,
  finishedAt: Timestamp,
  exitCode: z.number().int(),
  collectionFailed: z.boolean(),
  turbo: z.array(TurboDiagnosticSchema),
  browserSelection: BrowserSelectionSchema.optional(),
});

export type TaskDiagnostics = z.infer<typeof TaskDiagnosticsSchema>;

export async function summaryFiles(root: string): Promise<string[]> {
  try {
    const files = await readdir(path.join(root, ".turbo/runs"));
    return files.filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
}

async function readBoundedJson(
  filename: string,
  maxBytes = 20 * 1024 * 1024,
): Promise<unknown> {
  const file = Bun.file(filename);
  if (file.size > maxBytes)
    throw new Error("Diagnostic input exceeds its size limit");
  return file.json();
}

export async function collectTaskDiagnostics(
  identity: Omit<
    TaskDiagnostics,
    "turbo" | "browserSelection" | "collectionFailed"
  >,
  previousSummaries: ReadonlySet<string>,
  root: string,
): Promise<TaskDiagnostics> {
  const files = await summaryFiles(root);
  const turbo = await Promise.all(
    files
      .filter((name) => !previousSummaries.has(name))
      .sort()
      .map(async (name) =>
        TurboDiagnosticSchema.parse(
          // Full-repository summaries repeat each task's input hashes. The
          // measured graph is about 60 MiB before this allowlist strips inputs.
          await readBoundedJson(
            path.join(root, ".turbo/runs", name),
            128 * 1024 * 1024,
          ),
        ),
      ),
  );
  const selectionPath = path.join(root, "playwright-selection-report.json");
  const selectionFile = Bun.file(selectionPath);
  const browserSelection =
    identity.workflow === "playwright-e2e" && (await selectionFile.exists())
      ? BrowserSelectionSchema.parse(await readBoundedJson(selectionPath))
      : undefined;
  return TaskDiagnosticsSchema.parse({
    ...identity,
    collectionFailed: false,
    turbo,
    browserSelection,
  });
}
