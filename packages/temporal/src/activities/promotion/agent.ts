import { chmod, chown, mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { Context } from "@temporalio/activity";
import { z } from "zod/v4";
import { runAgentTurn } from "#lib/agent-runner/run.ts";
import type { AgentTurnUsage } from "#lib/agent-runner/contract.ts";
import { promotionProviderUid } from "./isolation.ts";
import {
  type PromotionRunInput,
  type PromotionState,
  type PromotionTarget,
} from "#shared/promotion.ts";
import { envForProvider } from "#activities/agent/agent-task-env.ts";
import { redactSecrets } from "#shared/redact.ts";
import { redactAgentTaskPayloadStrings } from "#activities/agent/agent-task-result.ts";
import {
  PromotionTaskResultSchema,
  PromotionTaskDraftSchema,
  PromotionPreviewDraftSchema,
  type PromotionTaskResult,
} from "./publication/task-contract.ts";
import { promotionContent, promotionMaintenanceContext } from "./manifest.ts";
import { promotionPrompt } from "./prompt.ts";
import { promotionTaskFiles } from "./publication/task-files.ts";
import { PromotionLoginsSchema, PromotionToolSchema } from "./tools.ts";
import type { PromotionEmailCodeReader } from "./access/credential-input.ts";
import { promotionConfig } from "#config/promotion.ts";
import type { PromotionStore } from "./store.ts";
import { promotionSecretTokens } from "./redaction.ts";
import { jsonLog } from "#activities/agent/agent-task-runtime.ts";
import { PromotionDiscordToolSchema } from "./discord-preview.ts";
import {
  promotionTransport,
  promotionRequiredEnv as required,
} from "./transport.ts";
import { recordPromotionDiagnostic } from "./publication/diagnostic.ts";
import { PromotionControlError } from "./control-error.ts";
import { recordPromotionExecutionHealth } from "./control/execution-health.ts";
import { promotionWindow } from "#shared/promotion/cadence.ts";
import { readPromotionState } from "./store.ts";
const PromotionAgentToolSchema = z.union([
  PromotionToolSchema,
  PromotionDiscordToolSchema,
]);

export async function cleanupPromotionResources(
  steps: readonly (readonly [string, () => Promise<void>])[],
  reportFailure: (name: string, error: unknown) => void,
): Promise<void> {
  for (const [name, cleanup] of steps) {
    try {
      await cleanup();
    } catch (error: unknown) {
      reportFailure(name, error);
    }
  }
}

function assertAssignment(
  target: PromotionTarget,
  mode: PromotionRunInput["mode"],
): void {
  if (target.action === "pending")
    throw new Error(
      "Target has no assigned action; omit it or supply a concrete inspection/update task",
    );
  if (mode !== "preview" && target.action === "inspect")
    throw new Error("Inspection assignments use preview mode");
}

type PromotionAgentInput = {
  batchId?: string;
  scheduled?: boolean;
  target: PromotionTarget;
  state: PromotionState;
  occurrenceId: string;
  mode: PromotionRunInput["mode"];
  store: PromotionStore;
  browserProfile?: string;
  readEmailCode?: PromotionEmailCodeReader;
  recordUsage?: (usage: AgentTurnUsage) => Promise<void>;
  generationStarting?: () => void;
  local?: {
    config: Awaited<ReturnType<typeof promotionConfig>>;
    enabled: () => Promise<boolean>;
    saveEvidence: (bytes: Uint8Array) => Promise<string>;
    recordUsage: (usage: AgentTurnUsage) => Promise<void>;
    generationStarting?: () => void;
    progress?: ((phase: string) => Promise<void>) | undefined;
  };
};
function assertAgentInput(input: PromotionAgentInput) {
  if (
    input.readEmailCode !== undefined &&
    input.mode !== "preview" &&
    input.local === undefined
  )
    throw new Error("Local email-code access is allowed only in preview");
  if (
    input.browserProfile !== undefined &&
    input.mode !== "preview" &&
    input.local === undefined
  )
    throw new Error("A browser profile override is allowed only in preview");
  assertAssignment(input.target, input.mode);
}
function executionOutcome(
  result: PromotionTaskResult,
  cleanup: { status: string } | null,
) {
  if (result.status === "verified" && cleanup?.status !== "blocked")
    return "success";
  return result.status === "deferred" ? "skip" : "failure";
}
async function agentConfiguration(input: PromotionAgentInput) {
  return input.local?.config ?? (await promotionConfig());
}
async function publishingEnabled(input: PromotionAgentInput) {
  if (input.scheduled === true) {
    const state = await readPromotionState(input.store, input.target.id);
    const others = {
      ...state,
      attempts: state.attempts.filter(
        (a) => a.occurrenceId !== input.occurrenceId,
      ),
    };
    if (!promotionWindow(input.target, others, Date.now()).allowed)
      return false;
  }
  if (input.local !== undefined) return await input.local.enabled();
  const latest = await promotionConfig();
  return latest.enabled && latest.enabledTargets.includes(input.target.id);
}
export async function runPromotionAgent(input: PromotionAgentInput) {
  assertAgentInput(input);
  const context = Context.current();
  if (input.local !== undefined && context.info.namespace !== "dev")
    throw new Error("Local execution is restricted to the dev namespace");
  const config = await agentConfiguration(input);
  const uid = promotionProviderUid();
  const completion = new AbortController();
  const signal = AbortSignal.any([
    completion.signal,
    context.cancellationSignal,
    AbortSignal.timeout(config.timeoutMinutes * 60_000),
  ]);
  const workdir = await mkdtemp(path.join(tmpdir(), "storm-promotion-"));
  const socket = path.join(
    tmpdir(),
    `storm-promotion-${crypto.randomUUID()}.sock`,
  );
  const logins = PromotionLoginsSchema.parse(
    JSON.parse(required("STORM_PROMOTION_LOGINS")),
  );
  const redact = [...promotionSecretTokens(logins)];
  const transport = promotionTransport({
    ...input,
    managedDiscord: input.local === undefined,
    signal,
    logins,
    maxSteps: config.maxSteps,
    monthlySolverUsd: config.monthlySolverUsd,
    ...(input.local === undefined
      ? {}
      : { saveEvidence: input.local.saveEvidence }),
    registerSecret: (value) => {
      redact.push(value);
    },
    enabled: () => publishingEnabled(input),
    heartbeat: () => {
      context.heartbeat({ targetId: input.target.id });
    },
  });
  const browserTrace: {
    endpoint: string;
    action: string | null;
    ref: string | null;
    error: string | null;
    code?: string;
    dispatchState?: "not_started" | "unknown";
    retryable?: boolean;
  }[] = [];
  const server = Bun.serve({
    unix: socket,
    fetch: async (request) => {
      if (
        request.method !== "POST" ||
        new URL(request.url).pathname !== "/tool"
      )
        return new Response("Not found", { status: 404 });
      let step: (typeof browserTrace)[number] | undefined;
      try {
        const body = PromotionAgentToolSchema.parse(await request.json());
        step = {
          endpoint: body.endpoint,
          action: body.endpoint === "action" ? body.body.kind : null,
          ref: body.endpoint === "action" ? (body.body.ref ?? null) : null,
          error: null,
        };
        browserTrace.push(step);
        return Response.json(
          redactAgentTaskPayloadStrings(await transport.handle(body), (text) =>
            redactSecrets(text, redact),
          ),
        );
      } catch (error: unknown) {
        const detail = redactSecrets(
          error instanceof Error ? error.message : String(error),
          redact,
        );
        const failure =
          error instanceof PromotionControlError
            ? {
                code: error.code,
                dispatchState: error.dispatchState,
                retryable: error.retryable,
                ref: error.ref,
              }
            : { dispatchState: "unknown" as const };
        if (step !== undefined)
          Object.assign(step, { error: detail, ...failure });
        return Response.json(
          {
            error: detail,
            ...failure,
          },
          { status: 400 },
        );
      }
    },
  });
  const heartbeat = setInterval(() => {
    context.heartbeat({ targetId: input.target.id });
  }, 15_000);
  const progress = localProgressHeartbeat(input);
  let draft: unknown;
  try {
    await chmod(socket, 0o660);
    if (uid !== undefined) await chown(socket, 0, uid);
    const content = await promotionContent(input.target);
    const previous = await input.store.read(
      `context/${input.target.id}.json`,
      PromotionTaskResultSchema,
    );
    const files = promotionTaskFiles({
      ...input,
      content,
      previous: previous?.value ?? null,
    });
    Object.assign(files, await transport.contextFiles());
    files["maintenance.md"] = await promotionMaintenanceContext();
    for (const [name, body] of Object.entries(files))
      await Bun.write(path.join(workdir, name), body);
    const env = {
      ...envForProvider("codex", workdir),
      PROMOTION_SOCKET: socket,
    };
    progress.start();
    await progress.report("Executing assignment");
    const outcome = await runAgentTurn({
      provider: "codex",
      service: "temporal",
      callSite: "storm-promotion",
      prompt: promotionPrompt({
        ...input,
        content,
      }),
      model: config.model,
      maxTurns: config.maxSteps,
      turnBudgetKind: "tool-steps",
      cwd: workdir,
      env,
      auth: { kind: "openai-api-key", apiKey: required("OPENAI_API_KEY") },
      signal,
      sandboxPolicy: {
        sandboxMode: "workspace-write",
        networkAccessEnabled: true,
        webSearchMode: "disabled",
      },
      scopedPermissions: {
        denyReadPaths: [
          path.join(homedir(), "Library/Application Support/MailMate"),
        ],
        unixSockets: [socket],
      },
      outputSchema: z.toJSONSchema(
        input.mode === "preview"
          ? PromotionPreviewDraftSchema
          : PromotionTaskDraftSchema,
        {
          target: "draft-7",
        },
      ),
      requireFinalText: true,
      skipGitRepoCheck: true,
      redactTokens: redact,
      beforeEvent: () => {
        context.heartbeat({ targetId: input.target.id });
        return Promise.resolve(true);
      },
      onEvent: (event) => {
        context.heartbeat({
          targetId: input.target.id,
          phase: event.type,
          elapsedMs: event.elapsedMs,
        });
      },
    });
    await input.local?.recordUsage(outcome.usage);
    await input.recordUsage?.(outcome.usage);
    progress.assertHealthy();
    if (outcome.finalText === undefined)
      throw new Error("Promotion agent omitted structured result");
    draft = JSON.parse(outcome.finalText) as unknown;
    const result = transport.journal.resolveDraft(draft);
    transport.journal.normalizeNativeCooldown(result);
    progress.stop();
    await progress.report("Verifying result");
    await transport.validateResult(result);
    await transport.journal.finish(result);
    if (
      !(await input.store.put(
        `context/${input.target.id}.json`,
        result,
        previous?.etag,
      ))
    )
      throw new Error("Concurrent promotion context update");
    // Receipt evidence and the verified effect are durable before deleting a bot reply.
    progress.stop();
    await progress.report("Receipt cleanup");
    const cleanup = await transport.afterFinish(result);
    await recordPromotionExecutionHealth({
      ...input,
      targetId: input.target.id,
      outcome: executionOutcome(result, cleanup),
    });
    return {
      result,
      ...(cleanup === null ? {} : { cleanup }),
      usage: outcome.usage,
      browserTrace,
      ...(input.mode === "preview"
        ? {
            observations: redactAgentTaskPayloadStrings(
              transport.journal.observations,
              (text) => redactSecrets(text, redact),
            ),
          }
        : {}),
      ...transport.audit(),
    };
  } catch (error: unknown) {
    await recordPromotionExecutionHealth({
      ...input,
      targetId: input.target.id,
      outcome: "failure",
    });
    await recordDiagnosticSafely({
      store: input.store,
      occurrenceId: input.occurrenceId,
      tokens: redact,
      diagnostic: {
        error: error instanceof Error ? error.message : String(error),
        draft: draft ?? null,
        observations: transport.journal.observations,
        browserTrace,
        ...transport.audit(),
      },
    });
    throw error;
  } finally {
    completion.abort();
    clearInterval(heartbeat);
    progress.stop();
    await cleanupPromotionResources(
      [
        ["server", () => server.stop(true)],
        ["transport", () => transport.close()],
        ["socket", () => rm(socket, { force: true })],
        ["workspace", () => rm(workdir, { recursive: true, force: true })],
      ],
      (step, error) => {
        jsonLog("warning", "Promotion cleanup failed", {
          targetId: input.target.id,
          step,
          detail: redactSecrets(
            error instanceof Error ? error.message : String(error),
            redact,
          ),
        });
      },
    );
  }
}

async function recordDiagnosticSafely(
  input: Parameters<typeof recordPromotionDiagnostic>[0],
) {
  try {
    await recordPromotionDiagnostic(input);
  } catch (error) {
    jsonLog("warning", "Promotion diagnostic could not be recorded", {
      occurrenceId: input.occurrenceId,
      detail: redactSecrets(
        error instanceof Error ? error.message : String(error),
        input.tokens,
      ),
    });
  }
}

function localProgressHeartbeat(input: PromotionAgentInput) {
  let failure: Error | undefined;
  const report = input.local?.progress;
  const beat = async () => {
    try {
      await report?.("Executing assignment");
    } catch (error) {
      failure =
        error instanceof Error ? error : new Error("Progress reporting failed");
    }
  };
  const timer =
    report === undefined
      ? undefined
      : setInterval(() => {
          void beat();
        }, 15_000);
  return {
    start() {
      input.generationStarting?.();
      input.local?.generationStarting?.();
    },
    async report(phase: string) {
      await report?.(phase);
    },
    assertHealthy() {
      if (failure !== undefined) throw failure;
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
    },
  };
}
