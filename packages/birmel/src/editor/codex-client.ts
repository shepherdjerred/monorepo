import { Codex } from "@openai/codex-sdk";
import { lstat } from "node:fs/promises";
import { attachCodexTrace } from "@shepherdjerred/llm-observability/wrappers/codex";
import { createCodexJsonlParser } from "@shepherdjerred/llm-observability/codex-jsonl";
import { createOpenRouterCodexConfig } from "@shepherdjerred/llm-runtime";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { metricsRegister } from "@shepherdjerred/birmel/observability/metrics.ts";
import { redactSecrets } from "@shepherdjerred/llm-observability";
import type { EditResult, FileChange } from "./types.ts";

const MODEL = "gpt-5.6-luna";
const logger = loggers.editor.child("codex-client");

export type ExecuteEditOptions = {
  prompt: string;
  workingDirectory: string;
  resumeSessionId?: string | undefined;
  allowedPaths?: string[] | undefined;
};

type CommandResult = { stdout: string; exitCode: number };

const CODEX_SESSION_PREFIX = "codex:";

async function runGit(
  workingDirectory: string,
  args: readonly string[],
): Promise<CommandResult> {
  const process = Bun.spawn(["git", ...args], {
    cwd: workingDirectory,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  return { stdout, exitCode };
}

async function changedPaths(
  workingDirectory: string,
  baselineCommit: string,
): Promise<string[]> {
  const tracked = await runGit(workingDirectory, [
    "diff",
    "--no-renames",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    "-z",
    baselineCommit,
    "--",
  ]);
  if (tracked.exitCode !== 0) throw new Error("Unable to read editor Git diff");
  const untracked = await runGit(workingDirectory, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  if (untracked.exitCode !== 0) {
    throw new Error("Unable to read untracked editor files");
  }
  return [tracked.stdout, untracked.stdout]
    .flatMap((output) => output.split("\0"))
    .filter((path) => path.length > 0)
    .toSorted()
    .filter((path, index, paths) => index === 0 || path !== paths[index - 1]);
}

export function pathsOutsideAllowed(
  paths: readonly string[],
  allowedPaths: readonly string[] | undefined,
): string[] {
  const patterns = allowedPaths ?? ["**/*"];
  const globs = patterns.map((pattern) => new Bun.Glob(pattern));
  return paths.filter((path) => !globs.some((glob) => glob.match(path)));
}

async function oldContent(
  workingDirectory: string,
  path: string,
  baselineCommit: string,
): Promise<string | null> {
  const result = await runGit(workingDirectory, [
    "show",
    `${baselineCommit}:${path}`,
  ]);
  return result.exitCode === 0 ? result.stdout : null;
}

async function newContent(
  workingDirectory: string,
  path: string,
): Promise<string | null> {
  const file = Bun.file(`${workingDirectory}/${path}`);
  if (!(await file.exists())) return null;
  const stat = await lstat(`${workingDirectory}/${path}`);
  if (!stat.isFile()) {
    throw new Error(`Codex editor changed a non-regular file: ${path}`);
  }
  return await file.text();
}

export async function changesFromGitDiff(
  workingDirectory: string,
  allowedPaths?: readonly string[],
  baselineCommit?: string,
): Promise<FileChange[]> {
  const baseline = baselineCommit ?? (await gitHead(workingDirectory));
  const paths = await changedPaths(workingDirectory, baseline);
  const disallowed = pathsOutsideAllowed(paths, allowedPaths);
  if (disallowed.length > 0) {
    throw new Error(
      `Codex editor changed paths outside allowedPaths: ${disallowed.join(", ")}`,
    );
  }
  return await Promise.all(
    paths.map(async (path): Promise<FileChange> => {
      const [before, after] = await Promise.all([
        oldContent(workingDirectory, path, baseline),
        newContent(workingDirectory, path),
      ]);
      return {
        filePath: path,
        oldContent: before,
        newContent: after,
        changeType:
          before === null ? "create" : after === null ? "delete" : "modify",
      };
    }),
  );
}

async function gitHead(workingDirectory: string): Promise<string> {
  const result = await runGit(workingDirectory, ["rev-parse", "HEAD"]);
  if (result.exitCode !== 0) {
    throw new Error("Unable to read editor Git baseline");
  }
  const commit = result.stdout.trim();
  if (commit.length === 0) {
    throw new Error("Unable to read editor Git baseline");
  }
  return commit;
}

function encodeSessionId(sessionId: string | undefined): string | null {
  return sessionId === undefined || sessionId.length === 0
    ? null
    : `${CODEX_SESSION_PREFIX}${sessionId}`;
}

function decodeSessionId(sessionId: string): string | undefined {
  if (!sessionId.startsWith(CODEX_SESSION_PREFIX)) return undefined;
  const decoded = sessionId.slice(CODEX_SESSION_PREFIX.length);
  return decoded.length > 0 ? decoded : undefined;
}

function codexEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"] as const) {
    const value = Bun.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export function threadSelection(
  resumeSessionId: string | undefined,
): { kind: "start" } | { kind: "resume"; id: string } {
  const decoded =
    resumeSessionId === undefined
      ? undefined
      : decodeSessionId(resumeSessionId);
  return decoded === undefined
    ? { kind: "start" }
    : { kind: "resume", id: decoded };
}

export async function executeEdit(
  opts: ExecuteEditOptions,
): Promise<EditResult> {
  const baselineCommit = await gitHead(opts.workingDirectory);
  const selection = threadSelection(opts.resumeSessionId);
  const openRouter = createOpenRouterCodexConfig({
    apiKey: Bun.env["OPENROUTER_API_KEY"] ?? "",
    modelId: MODEL,
    env: codexEnvironment(),
  });
  logger.info("Executing edit", {
    workingDirectory: opts.workingDirectory,
    model: openRouter.catalogModelId,
    hasResume: selection.kind === "resume",
  });
  const codex = new Codex(openRouter.codexOptions);
  const threadOptions = {
    approvalPolicy: "never" as const,
    model: openRouter.routeModelId,
    modelReasoningEffort: "high" as const,
    networkAccessEnabled: false,
    sandboxMode: "workspace-write" as const,
    webSearchMode: "disabled" as const,
    workingDirectory: opts.workingDirectory,
  };
  const thread =
    selection.kind === "start"
      ? codex.startThread(threadOptions)
      : codex.resumeThread(selection.id, threadOptions);
  const parser = createCodexJsonlParser();
  const trace = attachCodexTrace(parser, {
    service: "birmel",
    callSite: "editor-codex",
    model: MODEL,
    system: "codex_sdk",
    initialPrompt: opts.prompt,
    metricsRegister,
    workload: "editor-codex",
  });
  let traceOutcome: "success" | "error" = "success";
  let summary = "";
  try {
    const streamed = await trace.run(() => thread.runStreamed(opts.prompt));
    for await (const event of streamed.events) {
      const encodedEvent = JSON.stringify(redactSecrets(event));
      parser.push(`${encodedEvent}\n`);
      if (
        event.type === "item.completed" &&
        event.item.type === "agent_message"
      ) {
        summary = event.item.text;
      }
    }
  } catch (error: unknown) {
    traceOutcome = "error";
    throw error;
  } finally {
    parser.finish();
    trace.end(traceOutcome);
  }
  const changes = await changesFromGitDiff(
    opts.workingDirectory,
    opts.allowedPaths,
    baselineCommit,
  );
  summary = summary.trim();
  if (thread.id === null) {
    throw new Error("Codex thread did not return an ID");
  }
  logger.info("Edit complete", {
    sessionId: thread.id,
    changeCount: changes.length,
    model: openRouter.catalogModelId,
  });
  return {
    sdkSessionId: encodeSessionId(thread.id),
    changes,
    summary: summary.length > 0 ? summary : "Changes applied successfully.",
  };
}

export function checkCodexPrerequisites(): {
  installed: boolean;
  version: string | undefined;
  hasApiKey: boolean;
} {
  const apiKey = Bun.env["OPENROUTER_API_KEY"];
  return {
    installed: true,
    version: undefined,
    hasApiKey: apiKey !== undefined && apiKey.length > 0,
  };
}

export async function checkGhPrerequisites(): Promise<{ installed: boolean }> {
  try {
    const process = Bun.spawn(["gh", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return { installed: (await process.exited) === 0 };
  } catch {
    return { installed: false };
  }
}
