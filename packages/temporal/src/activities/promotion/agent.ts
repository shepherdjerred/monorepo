import { chmod, chown, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@temporalio/activity";
import { z } from "zod/v4";
import { runAgentTurn } from "#lib/agent-runner/run.ts";
import { promotionProviderUid } from "./isolation.ts";
import {
  type PromotionRunInput,
  type PromotionState,
  type PromotionTarget,
} from "#shared/promotion.ts";
import { envForProvider } from "#activities/agent/agent-task-env.ts";
import { redactSecrets } from "#shared/redact.ts";
import { redactAgentTaskPayloadStrings } from "#activities/agent/agent-task-result.ts";
import { PromotionBrowser } from "./browser.ts";
import { PromotionTaskJournal } from "./task.ts";
import {
  PromotionTaskResultSchema,
  PromotionPreviewResultSchema,
} from "./task-contract.ts";
import { promotionContent, promotionMaintenanceContext } from "./manifest.ts";
import { promotionPrompt } from "./prompt.ts";
import { promotionTaskFiles } from "./task-files.ts";
import {
  createPromotionToolHandler,
  PromotionLoginsSchema,
  PromotionToolSchema,
} from "./tools.ts";
import { promotionConfig } from "#config/promotion.ts";
import type { PromotionStore } from "./store.ts";
import { promotionSecretTokens } from "./redaction.ts";
import { jsonLog } from "#activities/agent/agent-task-runtime.ts";

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

function required(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is required for promotion`);
  return value;
}

export async function runPromotionAgent(input: {
  target: PromotionTarget;
  state: PromotionState;
  occurrenceId: string;
  mode: PromotionRunInput["mode"];
  store: PromotionStore;
  browserProfile?: string;
}) {
  if (input.browserProfile !== undefined && input.mode !== "preview")
    throw new Error("A browser profile override is allowed only in preview");
  const config = await promotionConfig();
  const uid = promotionProviderUid();
  const context = Context.current();
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
  const browser = new PromotionBrowser(
    input.target,
    required("PINCHTAB_BASE_URL"),
    required("PINCHTAB_TOKEN"),
    {
      signal,
      ...(input.browserProfile === undefined
        ? {}
        : { profile: input.browserProfile }),
    },
  );
  const logins = PromotionLoginsSchema.parse(
    JSON.parse(required("STORM_PROMOTION_LOGINS")),
  );
  const redact = promotionSecretTokens(logins);
  const journal = new PromotionTaskJournal({
    ...input,
    now: Date.now,
    enabled: async () => {
      const latest = await promotionConfig();
      return latest.enabled && latest.enabledTargets.includes(input.target.id);
    },
    capture: () => browser.capture(input.occurrenceId),
  });
  const handle = createPromotionToolHandler({
    ...input,
    browser,
    journal,
    targetId: input.target.id,
    account: input.target.account,
    reconciliation: input.mode === "reconcile",
    logins,
    preview: input.mode === "preview",
    maxToolCalls: config.maxSteps,
    solverKey: required("ANTI_CAPTCHA_API_KEY"),
    solverAllowanceMicrousd: Math.floor(config.monthlySolverUsd * 1_000_000),
    signal,
    heartbeat: () => {
      context.heartbeat({ targetId: input.target.id });
    },
  });
  const browserTrace: {
    endpoint: string;
    action: string | null;
    ref: string | null;
    error: string | null;
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
        const body = PromotionToolSchema.parse(await request.json());
        step = {
          endpoint: body.endpoint,
          action: body.endpoint === "action" ? body.body.kind : null,
          ref: body.endpoint === "action" ? (body.body.ref ?? null) : null,
          error: null,
        };
        browserTrace.push(step);
        return Response.json(
          redactAgentTaskPayloadStrings(await handle(body), (text) =>
            redactSecrets(text, redact),
          ),
        );
      } catch (error: unknown) {
        const detail = redactSecrets(
          error instanceof Error ? error.message : String(error),
          redact,
        );
        if (step !== undefined) step.error = detail;
        return Response.json(
          {
            error: detail,
          },
          { status: 400 },
        );
      }
    },
  });
  const heartbeat = setInterval(() => {
    context.heartbeat({ targetId: input.target.id });
  }, 15_000);
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
    files["maintenance.md"] = await promotionMaintenanceContext();
    for (const [name, body] of Object.entries(files))
      await Bun.write(path.join(workdir, name), body);
    const env = {
      ...envForProvider("codex", workdir),
      PROMOTION_SOCKET: socket,
    };
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
        sandboxMode: "danger-full-access",
        networkAccessEnabled: true,
        webSearchMode: "disabled",
      },
      outputSchema: z.toJSONSchema(
        input.mode === "preview"
          ? PromotionPreviewResultSchema
          : PromotionTaskResultSchema,
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
    if (outcome.finalText === undefined)
      throw new Error("Promotion agent omitted structured result");
    const result = PromotionTaskResultSchema.parse(
      JSON.parse(outcome.finalText),
    );
    await journal.finish(result);
    if (
      !(await input.store.put(
        `context/${input.target.id}.json`,
        result,
        previous?.etag,
      ))
    )
      throw new Error("Concurrent promotion context update");
    return {
      result,
      usage: outcome.usage,
      browserTrace,
    };
  } finally {
    completion.abort();
    clearInterval(heartbeat);
    await cleanupPromotionResources(
      [
        ["server", () => server.stop(true)],
        ["tab", () => browser.close()],
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
