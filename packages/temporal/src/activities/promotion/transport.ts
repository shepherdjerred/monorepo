import type { z } from "zod/v4";
import type {
  PromotionRunInput,
  PromotionState,
  PromotionTarget,
} from "#shared/promotion.ts";
import type { PromotionStore } from "./store.ts";
import { PromotionBrowser } from "./browser.ts";
import { PromotionTaskJournal } from "./task.ts";
import { PromotionDiscordPreview } from "./discord-preview.ts";
import {
  createPromotionToolHandler,
  type PromotionLoginsSchema,
} from "./tools.ts";
import type { PromotionTaskResult } from "./task-contract.ts";

export function promotionRequiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is required for promotion`);
  return value;
}

export function promotionTransport(input: {
  target: PromotionTarget;
  state: PromotionState;
  mode: PromotionRunInput["mode"];
  store: PromotionStore;
  occurrenceId: string;
  signal: AbortSignal;
  browserProfile?: string;
  logins: z.infer<typeof PromotionLoginsSchema>;
  maxSteps: number;
  monthlySolverUsd: number;
  enabled: () => Promise<boolean>;
  heartbeat: () => void;
}) {
  const browser =
    input.target.discord === undefined
      ? new PromotionBrowser(
          input.target,
          promotionRequiredEnv("PINCHTAB_BASE_URL"),
          promotionRequiredEnv("PINCHTAB_TOKEN"),
          {
            signal: input.signal,
            ...(input.browserProfile === undefined
              ? {}
              : { profile: input.browserProfile }),
          },
        )
      : undefined;
  const journal = new PromotionTaskJournal({
    ...input,
    now: Date.now,
    capture: () => {
      if (browser === undefined)
        throw new Error("Discord dry run cannot settle a receipt");
      return browser.capture(input.occurrenceId);
    },
  });
  if (input.target.discord !== undefined) {
    const discord = new PromotionDiscordPreview({
      ...input,
      socket: promotionRequiredEnv("PROMOTION_DISCORD_SOCKET"),
      journal,
      maxCalls: input.maxSteps,
    });
    return {
      journal,
      handle: (raw: unknown) => discord.handle(raw),
      contextFiles: async (): Promise<Record<string, string>> => ({
        "discord-context.json": JSON.stringify(
          await discord.inspect(),
          null,
          2,
        ),
      }),
      validateResult: (result: PromotionTaskResult) => {
        if (result.status === "preview" && discord.preparedActions.length !== 1)
          throw new Error(
            "Discord preview must record exactly one prepared action through its tool",
          );
      },
      audit: () => ({ preparedActions: discord.preparedActions }),
      close: () => Promise.resolve(),
    };
  }
  if (browser === undefined)
    throw new Error("Browser transport was not initialized");
  return {
    journal,
    handle: createPromotionToolHandler({
      ...input,
      browser,
      journal,
      targetId: input.target.id,
      account: input.target.account,
      reconciliation: input.mode === "reconcile",
      preview: input.mode === "preview",
      maxToolCalls: input.maxSteps,
      solverKey: promotionRequiredEnv("ANTI_CAPTCHA_API_KEY"),
      solverAllowanceMicrousd: Math.floor(input.monthlySolverUsd * 1_000_000),
    }),
    contextFiles: (): Promise<Record<string, string>> => Promise.resolve({}),
    validateResult: (_result: PromotionTaskResult): void => {
      /* Browser evidence is checked by the journal. */
    },
    audit: () => ({}),
    close: () => browser.close(),
  };
}
