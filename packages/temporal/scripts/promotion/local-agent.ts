import { chmod } from "node:fs/promises";
import path from "node:path";
import { MockActivityEnvironment } from "@temporalio/testing";
import type { z } from "zod/v4";
import { runPromotionAgent } from "#activities/promotion/agent.ts";
import {
  readPromotionState,
  type PromotionStore,
} from "#activities/promotion/store.ts";
import type { PromotionRunInput, PromotionTarget } from "#shared/promotion.ts";
import {
  executeLocalPromotion,
  type LocalPromotionSettings,
} from "./local-execution.ts";
import { reserveLocalAi } from "./local-budget.ts";
import { mailmateEmailCodeReader } from "./mailmate-code.ts";
import { promotionManifest } from "#activities/promotion/manifest.ts";
import { LocalPromotionStop } from "./local-stop.ts";
import { recordPromotionExecutionHealth } from "#activities/promotion/control/execution-health.ts";

async function paceAccount(target: PromotionTarget, store: PromotionStore) {
  const gap = target.discord === undefined ? 90_000 : 30_000;
  if (target.discord === undefined && target.account !== "reddit") return;
  const states = await Promise.all(
    promotionManifest.targets
      .filter((item) => item.account === target.account)
      .map((item) => readPromotionState(store, item.id)),
  );
  const latest = Math.max(
    0,
    ...states.flatMap((state) =>
      state.attempts
        .filter((attempt) => attempt.status !== "no-action")
        .map((attempt) => Date.parse(attempt.settledAt ?? attempt.attemptedAt)),
    ),
  );
  const wait = latest + gap - Date.now();
  if (wait > 0) await Bun.sleep(wait);
}

export function localActivityEnvironment(
  targetId: string,
  occurrenceId: string,
) {
  return new MockActivityEnvironment({
    namespace: "dev",
    workflowExecution: {
      workflowId: `storm-promotion/${targetId}`,
      runId: occurrenceId,
    },
  });
}

export async function runLocalTarget(input: {
  target: PromotionTarget;
  mode: PromotionRunInput["mode"];
  store: PromotionStore;
  settings: z.infer<typeof LocalPromotionSettings>;
  output: string;
  mailmate: boolean;
  secrets: string[];
  progress?: (phase: string, occurrenceId?: string) => Promise<void>;
}) {
  const { target, mode, store, settings, output } = input;
  if (target.action === "pending")
    throw new LocalPromotionStop("pending", target.notes);
  if (mode === "run") {
    await input.progress?.("Waiting for account pacing");
    await paceAccount(target, store);
  }
  const before = await readPromotionState(store, target.id);
  if (
    mode === "run" &&
    target.action !== "inspect" &&
    before.attempts.length === 0
  )
    throw new LocalPromotionStop(
      "history",
      "Import existing manual history before the first real run",
    );
  return await executeLocalPromotion<
    Awaited<ReturnType<typeof runPromotionAgent>>
  >({
    target,
    mode,
    store,
    execute: async ({ occurrenceId, state }) => {
      await input.progress?.("Starting agent", occurrenceId);
      const recordUsage = await reserveLocalAi(store, occurrenceId, settings);
      const environment = localActivityEnvironment(target.id, occurrenceId);
      const generation = { attempted: false };
      try {
        return await environment.run(() =>
          runPromotionAgent({
            target,
            state,
            occurrenceId,
            mode: target.action === "inspect" ? "preview" : mode,
            store,
            ...(input.mailmate
              ? {
                  readEmailCode: async (request) => {
                    const code = await mailmateEmailCodeReader()(request);
                    input.secrets.push(code);
                    return code;
                  },
                }
              : {}),
            local: {
              config: {
                ...settings,
                enabled: true,
                available: true,
                enabledTargets: [target.id],
              },
              recordUsage,
              generationStarting: () => {
                generation.attempted = true;
              },
              progress:
                input.progress === undefined
                  ? undefined
                  : async (phase) => {
                      await input.progress?.(phase, occurrenceId);
                    },
              enabled: async () => {
                const current = await readPromotionState(store, target.id);
                return !current.paused;
              },
              saveEvidence: async (bytes) => {
                const file = path.join(
                  output,
                  `${target.id}-${crypto.randomUUID()}.${target.discord === undefined ? "png" : "json"}`,
                );
                await Bun.write(file, bytes);
                await chmod(file, 0o600);
                return file;
              },
            },
          }),
        );
      } catch (error) {
        await recordPromotionExecutionHealth({
          store,
          targetId: target.id,
          occurrenceId,
          mode: target.action === "inspect" ? "preview" : mode,
          outcome: "failure",
        });
        if (!generation.attempted)
          await recordUsage({
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
          });
        throw error;
      }
    },
  });
}
