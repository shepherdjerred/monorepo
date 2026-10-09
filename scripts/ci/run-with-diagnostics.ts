#!/usr/bin/env bun
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { TaskDiagnostics } from "../lib/ci/task-diagnostics.ts";

type Identity = Omit<
  TaskDiagnostics,
  "turbo" | "browserSelection" | "collectionFailed"
>;

/** Keep this entrypoint dependency-free until the child has installed packages. */
export async function prepareDiagnostics(
  workflow: Identity["workflow"],
  root: string,
): Promise<Set<string>> {
  if (workflow === "playwright-e2e") {
    await rm(path.join(root, "playwright-selection-report.json"), {
      force: true,
    });
  }
  try {
    return new Set(await readdir(path.join(root, ".turbo/runs")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return new Set();
    throw error;
  }
}

async function publish(report: TaskDiagnostics): Promise<void> {
  const { writeJsonHandoff } = await import("../lib/ci/ci-handoff.ts");
  const { withCiObjectStoreRetry, CiObjectStoreHttpError } =
    await import("../lib/ci/ci-object-store-retry.ts");
  const signal = AbortSignal.timeout(20_000);
  await withCiObjectStoreRetry(() =>
    writeJsonHandoff(
      `diagnostics-${report.workflow}`,
      report,
      undefined,
      async (request) => {
        const response = await fetch(request, { signal });
        if (!response.ok) {
          await response.body?.cancel();
          throw new CiObjectStoreHttpError(
            "CI diagnostic upload failed",
            response.status,
          );
        }
        return response;
      },
    ),
  );
}

export async function retainDiagnostics(
  identity: Identity,
  before: ReadonlySet<string>,
  root: string,
  upload: (report: TaskDiagnostics) => Promise<void> = publish,
): Promise<number> {
  let report: TaskDiagnostics;
  try {
    const { collectTaskDiagnostics } =
      await import("../lib/ci/task-diagnostics.ts");
    report = await collectTaskDiagnostics(identity, before, root);
  } catch {
    // Do not include parser errors: they can echo rejected environment values.
    console.error(
      "CI task diagnostic collection failed; retaining failure metadata only",
    );
    report = { ...identity, collectionFailed: true, turbo: [] };
  }
  try {
    await upload(report);
    console.log(
      `CI task diagnostics: ci-handoff/${identity.pipeline}/diagnostics-${identity.workflow}.json`,
    );
  } catch {
    console.error(
      "CI task diagnostic publication failed; task exit status preserved",
    );
    return identity.exitCode === 0 ? 1 : identity.exitCode;
  }
  return identity.exitCode === 0 && report.collectionFailed
    ? 1
    : identity.exitCode;
}

async function main(args: string[]): Promise<number> {
  const [workflow, separator, ...command] = args;
  if (
    separator !== "--" ||
    command.length === 0 ||
    (workflow !== "verify" && workflow !== "playwright-e2e")
  ) {
    throw new Error(
      "Usage: run-with-diagnostics.ts verify|playwright-e2e -- <command> [args]",
    );
  }
  const pipeline = Bun.env["CI_PIPELINE_NUMBER"] ?? "";
  const commit = Bun.env["CI_COMMIT_SHA"] ?? "";
  if (!/^\d+$/u.test(pipeline) || !/^[a-f\d]{40}$/u.test(commit)) {
    throw new Error(
      "CI task diagnostics require a pipeline number and full commit SHA",
    );
  }
  const root = process.cwd();
  const before = await prepareDiagnostics(workflow, root);
  const startedAt = Date.now();
  const child = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...Bun.env },
  });
  const interrupt = () => {
    child.kill("SIGINT");
  };
  const terminate = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const exitCode = await child.exited;
    return await retainDiagnostics(
      {
        version: 1,
        workflow,
        pipeline,
        commit,
        startedAt,
        finishedAt: Date.now(),
        exitCode,
      },
      before,
      root,
    );
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  }
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
