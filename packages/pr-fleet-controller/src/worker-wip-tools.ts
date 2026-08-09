import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { captureTelemetryOperation } from "./controller-telemetry.ts";
import { currentTimestamp } from "./fleet-logic.ts";
import type { FleetEnvironment, FleetTelemetry } from "./ports.ts";
import type { RunEventCorrelation } from "./run-events.ts";
import {
  OperatorInputRequestDraftSchema,
  OperatorInputRequestSchema,
  PrStateSchema,
  type PrState,
} from "./schemas.ts";
import type { FleetStore } from "./state.ts";
import { containedPath } from "./worker-file-edits.ts";

type RecordTool = <T>(
  tool: string,
  input: unknown,
  run: () => Promise<T>,
) => Promise<T>;

const MAX_INHERITED_EVIDENCE_BYTES = 100_000;

export function boundedInheritedWipEvidence(
  evidence: string,
  label: string,
  maxBytes = MAX_INHERITED_EVIDENCE_BYTES,
): { evidence: string; complete: boolean } {
  if (Buffer.byteLength(evidence, "utf8") <= maxBytes) {
    return { evidence, complete: true };
  }
  const prefix = Buffer.from(evidence, "utf8")
    .subarray(0, maxBytes)
    .toString("utf8");
  return {
    evidence: `${prefix}\n[TRUNCATED: ${label} exceeds the remaining inherited-WIP evidence budget; publication is disabled]`,
    complete: false,
  };
}

export function boundedInheritedCommitEvidence(
  commitLog: string,
  patch: string,
): { evidence: string; complete: boolean } {
  const evidence = `Commit metadata and changed paths:\n${commitLog}\nComplete patch:\n${patch}`;
  if (Buffer.byteLength(evidence, "utf8") <= MAX_INHERITED_EVIDENCE_BYTES) {
    return { evidence, complete: true };
  }
  const prefix = Buffer.from(evidence, "utf8")
    .subarray(0, MAX_INHERITED_EVIDENCE_BYTES)
    .toString("utf8");
  return {
    evidence: `${prefix}\n[TRUNCATED: inherited commit evidence exceeds ${String(MAX_INHERITED_EVIDENCE_BYTES)} bytes; publication is disabled]`,
    complete: false,
  };
}

export function requireCompleteInheritedCommitInspection(
  store: FleetStore,
  pr: PrState,
  localHeadSha: string,
): void {
  const inspection = store.inheritedCommitInspections.get(pr.identity.number);
  if (
    inspection === undefined ||
    !inspection.complete ||
    inspection.remoteHeadSha !== pr.identity.headSha ||
    inspection.localHeadSha !== localHeadSha
  ) {
    throw new Error(
      "Inherited commits must have complete current-head metadata, changed-path, and patch evidence before publication",
    );
  }
}

export function requireCompleteInheritedWipInspection(
  store: FleetStore,
  pr: PrState,
): void {
  store.requireCompleteInheritedWipInspection(pr);
}

export function abortWorkerForOperatorInput(
  store: FleetStore,
  prNumber: number,
): void {
  store.cancelledWorkers.add(prNumber);
  store.workerControllers.get(prNumber)?.abort();
}

async function runGit(
  environment: FleetEnvironment,
  worktree: string,
  signal: AbortSignal,
  args: string[],
): Promise<string> {
  const result = await environment.runLocalCommand({
    executable: "git",
    args,
    cwd: worktree,
    timeoutMs: 30_000,
    signal,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

async function untrackedDiff(
  environment: FleetEnvironment,
  worktree: string,
  signal: AbortSignal,
  paths: string[],
): Promise<string> {
  const patches: string[] = [];
  for (const untrackedPath of paths) {
    const result = await environment.runLocalCommand({
      executable: "git",
      args: [
        "diff",
        "--no-index",
        "--binary",
        "--",
        "/dev/null",
        untrackedPath,
      ],
      cwd: worktree,
      timeoutMs: 30_000,
      signal,
    });
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(
        `git diff for untracked path ${untrackedPath} failed: ${result.stderr}`,
      );
    }
    patches.push(result.stdout);
  }
  return patches.join("\n");
}

export function createWorkerWipTools(options: {
  pr: PrState;
  store: FleetStore;
  environment: FleetEnvironment;
  worktree: string;
  signal: AbortSignal;
  telemetry: FleetTelemetry | undefined;
  parentCorrelation: () => RunEventCorrelation;
  record: RecordTool;
  assertNotWaitingForAnswer: () => void;
}) {
  const {
    pr,
    store,
    environment,
    worktree,
    signal,
    telemetry,
    parentCorrelation,
    record,
    assertNotWaitingForAnswer,
  } = options;
  return {
    inspect_worktree_wip: createTool({
      id: "inspect_worktree_wip",
      description:
        "Inspect inherited work in the assigned checkout: complete/truncated status and staged, unstaged, untracked, and local-commit patches plus the local/remote relation. Publication remains disabled when required evidence is truncated. Use this before deciding whether existing operator work clearly belongs to the PR or requires operator guidance.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        context: PrStateSchema.shape.worktreeContext,
        status: z.string(),
        statusComplete: z.boolean(),
        stagedDiff: z.string(),
        stagedDiffComplete: z.boolean(),
        unstagedDiff: z.string(),
        unstagedDiffComplete: z.boolean(),
        untrackedDiff: z.string(),
        untrackedDiffComplete: z.boolean(),
        wipEvidenceComplete: z.boolean(),
        localCommits: z.string(),
        localCommitEvidenceComplete: z.boolean(),
      }),
      execute: (input) =>
        record("inspect_worktree_wip", input, async () => {
          const status = await runGit(environment, worktree, signal, [
            "status",
            "--short",
          ]);
          const stagedDiff = await runGit(environment, worktree, signal, [
            "diff",
            "--cached",
            "--",
          ]);
          const unstagedDiff = await runGit(environment, worktree, signal, [
            "diff",
            "--",
          ]);
          const untrackedPathsOutput = await runGit(
            environment,
            worktree,
            signal,
            ["ls-files", "-z", "--others", "--exclude-standard"],
          );
          const untrackedPaths = untrackedPathsOutput
            .split("\0")
            .filter((value) => value.length > 0);
          const untrackedPatch = await untrackedDiff(
            environment,
            worktree,
            signal,
            untrackedPaths,
          );
          let remainingWipEvidenceBytes = MAX_INHERITED_EVIDENCE_BYTES;
          const boundWipSection = (evidence: string, label: string) => {
            const bounded = boundedInheritedWipEvidence(
              evidence,
              label,
              remainingWipEvidenceBytes,
            );
            remainingWipEvidenceBytes -= Math.min(
              Buffer.byteLength(evidence, "utf8"),
              remainingWipEvidenceBytes,
            );
            return bounded;
          };
          const boundedStatus = boundWipSection(status, "worktree status");
          const boundedStaged = boundWipSection(
            stagedDiff,
            "staged inherited diff",
          );
          const boundedUnstaged = boundWipSection(
            unstagedDiff,
            "unstaged inherited diff",
          );
          const boundedUntracked = boundWipSection(
            untrackedPatch,
            "untracked inherited diff",
          );
          const wipEvidenceComplete = [
            boundedStatus,
            boundedStaged,
            boundedUnstaged,
            boundedUntracked,
          ].every((bounded) => bounded.complete);
          let localCommits = "No ahead-of-remote inherited commits.";
          let localCommitEvidenceComplete = true;
          const context = pr.worktreeContext;
          if (context?.relation === "ahead") {
            const localHeadOutput = await runGit(
              environment,
              worktree,
              signal,
              ["rev-parse", "HEAD"],
            );
            const localHeadSha = localHeadOutput.trim();
            if (localHeadSha !== context.localHeadSha) {
              throw new Error(
                "Local HEAD changed after inherited work was captured; inspect again",
              );
            }
            const inheritedRange = `${pr.identity.headSha}..HEAD`;
            const commitLog = await runGit(environment, worktree, signal, [
              "log",
              "--format=fuller",
              "--name-status",
              "--no-renames",
              inheritedRange,
              "--",
            ]);
            const patch = await runGit(environment, worktree, signal, [
              "diff",
              "--binary",
              "--full-index",
              "--no-ext-diff",
              inheritedRange,
              "--",
            ]);
            const bounded = boundedInheritedCommitEvidence(commitLog, patch);
            localCommits = bounded.evidence;
            localCommitEvidenceComplete = bounded.complete;
            store.inheritedCommitInspections.set(pr.identity.number, {
              remoteHeadSha: pr.identity.headSha,
              localHeadSha,
              complete: bounded.complete,
            });
          } else {
            store.inheritedCommitInspections.delete(pr.identity.number);
          }
          if (context?.dirty === true) {
            store.inheritedWipInspections.set(pr.identity.number, {
              remoteHeadSha: context.remoteHeadSha,
              localHeadSha: context.localHeadSha,
              complete: wipEvidenceComplete,
            });
          } else {
            store.inheritedWipInspections.delete(pr.identity.number);
          }
          return {
            context,
            status: boundedStatus.evidence,
            statusComplete: boundedStatus.complete,
            stagedDiff: boundedStaged.evidence,
            stagedDiffComplete: boundedStaged.complete,
            unstagedDiff: boundedUnstaged.evidence,
            unstagedDiffComplete: boundedUnstaged.complete,
            untrackedDiff: boundedUntracked.evidence,
            untrackedDiffComplete: boundedUntracked.complete,
            wipEvidenceComplete,
            localCommits,
            localCommitEvidenceComplete,
          };
        }),
    }),
    request_operator_input: createTool({
      id: "request_operator_input",
      description:
        "Ask the operator only after inspecting discoverable evidence and finding a material intent or ownership decision that cannot be resolved safely. Provide one to three short questions, two or three concrete options each, exactly one recommended option, and enough context to decide. After calling this tool, return waiting-for-answer with its request ID and do no more work.",
      inputSchema: OperatorInputRequestDraftSchema,
      outputSchema: OperatorInputRequestSchema,
      execute: async (input) => {
        const pendingRequest = await record(
          "request_operator_input",
          input,
          () => {
            if (store.operatorRequests.has(pr.identity.number)) {
              throw new Error(
                `PR #${String(pr.identity.number)} already has an unanswered operator request`,
              );
            }
            const id = captureTelemetryOperation(
              "operator question ID",
              () =>
                telemetry?.newId("operator-question") ?? crypto.randomUUID(),
            );
            const request = OperatorInputRequestSchema.parse({
              ...input,
              id,
              pr: pr.identity.number,
              headSha: pr.identity.headSha,
              generation: pr.agentGeneration,
              createdAt: currentTimestamp(),
            });
            captureTelemetryOperation("operator.question.asked", () => {
              telemetry?.record(
                "operator.question.asked",
                { request },
                {
                  ...parentCorrelation(),
                  prNumber: request.pr,
                  headSha: request.headSha,
                  generation: request.generation,
                },
              );
            });
            store.operatorRequests.set(pr.identity.number, request);
            return Promise.resolve(request);
          },
        );
        // Persist the request and its complete tool lifecycle before ending the
        // model turn. Normal worker settlement waits for in-flight commands to
        // stop, releases every lease, and parks only this PR.
        abortWorkerForOperatorInput(store, pr.identity.number);
        return pendingRequest;
      },
    }),
    unstage_paths: createTool({
      id: "unstage_paths",
      description:
        "Unstage explicit inherited paths while preserving their working-tree contents. Use only after inspecting staged WIP; this never discards file content.",
      inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1).max(100),
      }),
      outputSchema: z.object({ paths: z.array(z.string()) }),
      execute: (input) =>
        record("unstage_paths", input, async () => {
          assertNotWaitingForAnswer();
          requireCompleteInheritedWipInspection(store, pr);
          if (!store.requestLease(pr, "stack-write")) {
            throw new Error("Stack write lease is not available");
          }
          for (const requestedPath of input.paths) {
            await containedPath(worktree, requestedPath);
          }
          const result = await environment.runLocalCommand({
            executable: "git",
            args: ["reset", "HEAD", "--", ...input.paths],
            cwd: worktree,
            timeoutMs: 30_000,
            signal,
          });
          if (result.exitCode !== 0) {
            throw new Error(`Failed to unstage paths: ${result.stderr.trim()}`);
          }
          return { paths: input.paths };
        }),
    }),
    publish_inherited_commits: createTool({
      id: "publish_inherited_commits",
      description:
        "Publish already-validated local commits that are descendants of the captured PR head, without committing unrelated working-tree changes. Use only after inspect_worktree_wip returns complete commit metadata, changed paths, and patch evidence and every inherited commit clearly belongs to this PR.",
      inputSchema: z.object({}),
      outputSchema: z.object({ headSha: z.string() }),
      execute: (input) =>
        record("publish_inherited_commits", input, async () => {
          assertNotWaitingForAnswer();
          if (!store.requestLease(pr, "stack-write")) {
            throw new Error("Stack write lease is not available");
          }
          const context = pr.worktreeContext;
          if (context?.relation !== "ahead") {
            throw new Error(
              "Inherited commit publication requires a captured ahead-of-remote worktree",
            );
          }
          const head = await environment.runLocalCommand({
            executable: "git",
            args: ["rev-parse", "HEAD"],
            cwd: worktree,
            timeoutMs: 30_000,
            signal,
          });
          if (head.exitCode !== 0) {
            throw new Error(`Failed to read local HEAD: ${head.stderr.trim()}`);
          }
          if (head.stdout.trim() !== context.localHeadSha) {
            throw new Error(
              "Local HEAD changed after inherited work was captured; inspect again or ask the operator",
            );
          }
          requireCompleteInheritedCommitInspection(
            store,
            pr,
            head.stdout.trim(),
          );
          const relation = await environment.runLocalCommand({
            executable: "git",
            args: ["merge-base", "--is-ancestor", pr.identity.headSha, "HEAD"],
            cwd: worktree,
            timeoutMs: 30_000,
            signal,
          });
          if (relation.exitCode !== 0) {
            throw new Error(
              "Local HEAD is not a descendant of the captured PR head; reconcile or ask the operator before publication",
            );
          }
          try {
            const published = await environment.publishRestack(
              pr,
              signal,
              "inherited-commits",
            );
            store.inheritedCommitInspections.delete(pr.identity.number);
            return published;
          } finally {
            store.releaseLease(pr.identity.number, "stack-write", pr.stackId);
          }
        }),
    }),
  };
}
