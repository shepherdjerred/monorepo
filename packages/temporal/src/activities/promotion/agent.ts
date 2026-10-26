import { chmod, chown, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@temporalio/activity";
import { z } from "zod/v4";
import { runAgentTurn } from "#lib/agent-runner/run.ts";
import { providerSubprocessUid } from "#shared/agent/agent-subprocess-identity.ts";
import {
  PromotionAgentResultSchema,
  type PromotionRunInput,
  type PromotionState,
  type PromotionTarget,
} from "#shared/promotion.ts";
import {
  envForProvider,
  agentTaskSecretTokens,
} from "#activities/agent/agent-task-env.ts";
import { redactSecrets } from "#shared/redact.ts";
import { redactAgentTaskPayloadStrings } from "#activities/agent/agent-task-result.ts";
import { PromotionBrowser } from "./browser.ts";
import { PromotionGateway } from "./gateway.ts";
import { promotionContent } from "./manifest.ts";
import { promotionPrompt } from "./prompt.ts";
import { createPromotionToolHandler, PromotionLoginsSchema } from "./tools.ts";
import { promotionConfig } from "#config/promotion.ts";
import type { PromotionStore } from "./store.ts";

function required(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is required for promotion`);
  return value;
}

const TOOL_CLIENT = `const request = JSON.parse(await Bun.stdin.text());
const socket = process.env.PROMOTION_SOCKET;
if (!socket) throw new Error("PROMOTION_SOCKET missing");
const response = await fetch("http://promotion/tool", {unix:socket, method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)});
console.log(await response.text());
if (!response.ok) process.exitCode=1;
`;

export async function runPromotionAgent(input: {
  target: PromotionTarget;
  state: PromotionState;
  occurrenceId: string;
  mode: PromotionRunInput["mode"];
  store: PromotionStore;
}) {
  const config = await promotionConfig();
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
    signal,
  );
  const logins = PromotionLoginsSchema.parse(
    JSON.parse(required("STORM_PROMOTION_LOGINS")),
  );
  const redact = agentTaskSecretTokens(undefined);
  const gateway = new PromotionGateway({
    ...input,
    preview: input.mode === "preview",
    now: Date.now,
    enabled: async () => {
      const latest = await promotionConfig();
      return latest.enabled && latest.enabledTargets.includes(input.target.id);
    },
    submit: (selector) => browser.submit(selector),
    capture: () => browser.capture(input.occurrenceId),
  });
  const handle = createPromotionToolHandler({
    ...input,
    browser,
    gateway,
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
  const server = Bun.serve({
    unix: socket,
    fetch: async (request) => {
      if (
        request.method !== "POST" ||
        new URL(request.url).pathname !== "/tool"
      )
        return new Response("Not found", { status: 404 });
      try {
        const body: unknown = await request.json();
        return Response.json(
          redactAgentTaskPayloadStrings(await handle(body), (text) =>
            redactSecrets(text, redact),
          ),
        );
      } catch (error: unknown) {
        return Response.json(
          {
            error: redactSecrets(
              error instanceof Error ? error.message : String(error),
              redact,
            ),
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
    const uid = providerSubprocessUid();
    if (uid !== undefined) await chown(socket, 0, uid);
    await Bun.write(path.join(workdir, "tool.ts"), TOOL_CLIENT);
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
        content: await promotionContent(input.target),
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
      outputSchema: z.toJSONSchema(PromotionAgentResultSchema, {
        target: "draft-7",
      }),
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
    return {
      result: PromotionAgentResultSchema.parse(JSON.parse(outcome.finalText)),
      usage: outcome.usage,
    };
  } finally {
    completion.abort();
    clearInterval(heartbeat);
    await server.stop(true);
    // Close only this run's tab; retain the authenticated account profile.
    try {
      await browser.close();
    } finally {
      await rm(socket, { force: true });
      await rm(workdir, { recursive: true, force: true });
    }
  }
}
