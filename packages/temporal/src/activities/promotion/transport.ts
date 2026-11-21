import type { z } from "zod/v4";
import type {
  PromotionRunInput,
  PromotionState,
  PromotionTarget,
} from "#shared/promotion/model.ts";
import type { PromotionStore } from "./store.ts";
import {
  assertRedditPromotionAccountAvailable,
  readRedditPromotionAccount,
  recordRedditAccountFailure,
  recordRedditAccountSuccess,
} from "./reddit-outreach/ownership.ts";
import { PromotionBrowser } from "./browser.ts";
import { approvedDiscordCopy } from "./publication/approved-copy.ts";
import { ensurePromotionDiscord } from "./discord-session.ts";
import { savePromotionEvidence } from "./publication/evidence.ts";
import { PromotionTaskJournal } from "./publication/task.ts";
import { PromotionDiscordPreview } from "./discord-preview.ts";
import {
  createPromotionToolHandler,
  type PromotionLoginsSchema,
} from "./tools.ts";
import type { PromotionTaskResult } from "./publication/task-contract.ts";
import type { PromotionEmailCodeReader } from "./access/credential-input.ts";
import {
  capturePublicRedditReceipt,
  publicRedditReceiptUrl,
} from "./publication/public-receipt.ts";

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
  beforeMutation?: () => Promise<void>;
  beforeRedditNavigation?: (() => Promise<void>) | undefined;
  replyText?: string;
  heartbeat: () => void;
  registerSecret?: (value: string) => void;
  readEmailCode?: PromotionEmailCodeReader;
  saveEvidence?: (bytes: Uint8Array) => Promise<string>;
  managedDiscord?: boolean;
  batchId?: string;
}) {
  const saveEvidence =
    input.saveEvidence ??
    ((bytes: Uint8Array) =>
      savePromotionEvidence(
        input.target.id,
        input.occurrenceId,
        bytes,
        input.target.discord !== undefined,
      ));
  const browser =
    input.target.discord === undefined
      ? new PromotionBrowser(
          input.target,
          promotionRequiredEnv("PINCHTAB_BASE_URL"),
          promotionRequiredEnv("PINCHTAB_TOKEN"),
          {
            signal: input.signal,
            ...(input.target.account === "reddit"
              ? {
                  beforeRedditNavigation: async () => {
                    assertRedditPromotionAccountAvailable(
                      await readRedditPromotionAccount(input.store),
                    );
                    await input.beforeRedditNavigation?.();
                  },
                  redditAccount: {
                    failure: async (
                      failure: Parameters<typeof recordRedditAccountFailure>[1],
                    ) => {
                      await recordRedditAccountFailure(input.store, failure);
                    },
                    success: async () => {
                      await recordRedditAccountSuccess(input.store);
                    },
                  },
                }
              : {}),
            ...(input.browserProfile === undefined
              ? {}
              : { profile: input.browserProfile }),
          },
        )
      : undefined;
  let discordTransport: PromotionDiscordPreview | undefined;
  let expectedReceipt: PromotionTaskResult["receipt"] = null;
  const journal = new PromotionTaskJournal({
    ...input,
    enabled: async () => {
      if (input.target.account === "reddit")
        assertRedditPromotionAccountAvailable(
          await readRedditPromotionAccount(input.store),
        );
      return await input.enabled();
    },
    now: Date.now,
    capture: async () => {
      if (browser === undefined) {
        if (discordTransport === undefined)
          throw new Error("Discord transport unavailable");
        return discordTransport.capture();
      }
      const save = saveEvidence;
      if (input.target.id.startsWith("reddit-")) {
        if (expectedReceipt === null)
          throw new Error("Public capture requires the selected receipt");
        const page = await browser.receiptSnapshot();
        return capturePublicRedditReceipt({
          target: input.target,
          url: page.url,
          baseUrl: promotionRequiredEnv("PINCHTAB_BASE_URL"),
          token: promotionRequiredEnv("PINCHTAB_TOKEN"),
          signal: input.signal,
          saveEvidence: save,
          expectedQuote: expectedReceipt.quote,
        });
      }
      const page = await browser.receiptSnapshot();
      const screenshotKey = await save(await browser.screenshot());
      return { ...page, screenshotKey };
    },
  });
  if (input.target.discord !== undefined) {
    const discord = new PromotionDiscordPreview({
      ...input,
      socket: promotionRequiredEnv("PROMOTION_DISCORD_SOCKET"),
      journal,
      maxCalls: input.maxSteps,
      approvedMessages: approvedDiscordCopy(),
      saveEvidence,
    });
    discordTransport = discord;
    return {
      journal,
      handle: (raw: unknown) => discord.handle(raw),
      contextFiles: async (): Promise<Record<string, string>> => {
        if (input.managedDiscord === true) {
          const login = input.logins["discord"];
          if (login === undefined) throw new Error("Outreach login missing");
          await ensurePromotionDiscord(
            login,
            promotionRequiredEnv("PROMOTION_DISCORD_SOCKET"),
            input.batchId ?? input.occurrenceId,
          );
        }
        return {
          "approved-messages.json": JSON.stringify(await approvedDiscordCopy()),
          "discord-context.json": JSON.stringify(
            await discord.inspect(),
            null,
            2,
          ),
        };
      },
      validateResult: async (result: PromotionTaskResult) => {
        discord.normalizeResult(result);
        if (result.receipt !== null)
          result.receipt = await discord.resolveReceipt(result.receipt);
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
    validateResult: (result: PromotionTaskResult): Promise<void> => {
      if (input.target.id.startsWith("reddit-") && result.receipt !== null) {
        result.receipt.url = publicRedditReceiptUrl(result.receipt.url);
        expectedReceipt = result.receipt;
      }
      /* Browser evidence is checked by the journal. */
      return Promise.resolve();
    },
    audit: () => ({}),
    close: () => browser.close(),
  };
}
