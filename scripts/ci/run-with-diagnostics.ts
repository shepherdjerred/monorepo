#!/usr/bin/env bun
import { mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { TaskDiagnostics } from "../lib/ci/task-diagnostics.ts";
import { startBenchmarkResources } from "./benchmark-resources.ts";

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
  return identity.exitCode === 0 &&
    (report.collectionFailed ||
      report.benchmarkResources?.collectionFailed === true)
    ? 1
    : identity.exitCode;
}

async function retainFromArgs(args: string[]): Promise<number> {
  try {
    const { z } = await import("zod");
    const { TaskDiagnosticsSchema } =
      await import("../lib/ci/task-diagnostics.ts");
    let identity: unknown;
    let previous: string[];
    if (args[0] === "--retain-file") {
      const file = Bun.file(args[1] ?? "");
      if (file.size > 1024 * 1024)
        throw new Error("Diagnostic payload too large");
      const payload = z
        .object({ identity: z.unknown(), previous: z.array(z.string()) })
        .parse(await file.json());
      identity = payload.identity;
      previous = payload.previous;
    } else {
      identity = JSON.parse(args[1] ?? "null");
      previous = z.array(z.string()).parse(JSON.parse(args[2] ?? "null"));
    }
    const parsed = TaskDiagnosticsSchema.omit({
      turbo: true,
      browserSelection: true,
      collectionFailed: true,
    }).parse(identity);
    return await retainDiagnostics(parsed, new Set(previous), process.cwd());
  } catch {
    // Bootstrap or schema errors may include rejected values. Keep them out
    // of CI logs, just like collection and upload errors above.
    console.error("CI task diagnostic process failed");
    return 1;
  }
}

async function scratchResources(workflow: string, commit: string) {
  if (Bun.env["CI_BENCHMARK_FEATURE"] !== "scratch") return;
  const variant = Bun.env["CI_BENCHMARK_VARIANT"];
  if (
    workflow !== "verify" ||
    Bun.env["CI_BENCHMARK_SOURCE"] !== commit ||
    Bun.env["CI_BENCHMARK_PROFILE"] !== "verify" ||
    (variant !== "baseline" && variant !== "candidate")
  )
    throw new Error("Invalid scratch benchmark resource request");
  return startBenchmarkResources(variant);
}

function invocation(args: string[]): {
  workflow: Identity["workflow"];
  pipeline: string;
  commit: string;
  command: string[];
} {
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
  return { workflow, pipeline, commit, command };
}

async function main(args: string[]): Promise<number> {
  if (args[0] === "--retain" || args[0] === "--retain-file")
    return retainFromArgs(args);
  const { workflow, pipeline, commit, command } = invocation(args);
  const root = process.cwd();
  const before = await prepareDiagnostics(workflow, root);
  const resources = await scratchResources(workflow, commit);
  const startedAt = Date.now();
  let child: Bun.Subprocess<"inherit", "inherit", "inherit">;
  try {
    child = Bun.spawn(command, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: { ...Bun.env },
    });
  } catch (error) {
    await resources?.finish();
    throw error;
  }
  let payloadDirectory: string | undefined;
  const interrupt = () => {
    child.kill("SIGINT");
  };
  const terminate = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  let commandExitCode: number | undefined;
  try {
    const exitCode = await child.exited;
    commandExitCode = exitCode;
    const finishedAt = Date.now();
    const benchmarkResources = await resources?.finish();
    // A long run's samples can exceed Linux's per-argument size limit. A private
    // file also keeps the complete observations out of process arguments.
    // Keep it outside TMPDIR: that is the scratch mount being measured, and
    // even an ENOSPC failure must leave room to transfer its diagnostics.
    payloadDirectory = await mkdtemp(
      path.join(root, ".git", "ci-diagnostic-payload-"),
    );
    const payloadFile = path.join(payloadDirectory, "payload.json");
    await Bun.write(
      payloadFile,
      JSON.stringify({
        identity: {
          version: 1,
          workflow,
          pipeline,
          commit,
          startedAt,
          finishedAt,
          exitCode,
          ...(benchmarkResources === undefined ? {} : { benchmarkResources }),
        } satisfies Identity,
        previous: [...before],
      }),
    );
    // Bun caches missing package resolution before the child installs the
    // workspace. A fresh process can resolve those newly installed packages.
    child = Bun.spawn(
      [
        process.execPath,
        "--no-install",
        import.meta.path,
        "--retain-file",
        payloadFile,
      ],
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: { ...Bun.env },
      },
    );
    const diagnosticExit = await child.exited;
    return exitCode === 0 ? diagnosticExit : exitCode;
  } catch {
    console.error("CI diagnostic process failed; task exit status preserved");
    return commandExitCode === undefined || commandExitCode === 0
      ? 1
      : commandExitCode;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    await resources?.finish();
    if (payloadDirectory !== undefined)
      await rm(payloadDirectory, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
