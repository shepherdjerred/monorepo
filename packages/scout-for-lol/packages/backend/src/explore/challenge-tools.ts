import { tool } from "ai";
import { z } from "zod";
import {
  AccountIdSchema,
  ChallengeContractV1Schema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import {
  previewChallengeDraft,
  validateChallengeDraft,
} from "#src/progression/challenges/drafts.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

const ChallengeToolResultSchema = z.strictObject({
  kind: z.string(),
  message: z.string(),
  data: z.unknown(),
});

export async function challengeExploreEnabled(
  guildIds: readonly string[],
): Promise<boolean> {
  const decisions = await Promise.all(
    guildIds.map((guildId) =>
      isPolicyEnabled("challenge_runs_enabled", {
        server: DiscordGuildIdSchema.parse(guildId),
      }),
    ),
  );
  return decisions.some(Boolean);
}

export function createChallengeExploreTools(options: {
  readonly requesterId: DiscordAccountId;
  readonly track: ToolTracker;
}) {
  return {
    list_challenge_accounts: tool({
      description:
        "List the requester's linked Riot accounts and stable account IDs before previewing a challenge.",
      inputSchema: z.strictObject({}),
      outputSchema: ChallengeToolResultSchema,
      execute: () =>
        options.track("list_challenge_accounts", async () => {
          const players = await prisma.player.findMany({
            where: { discordId: options.requesterId },
            orderBy: [{ alias: "asc" }, { serverId: "asc" }],
            include: { accounts: { orderBy: { alias: "asc" } } },
          });
          const accounts = players.flatMap((player) =>
            player.accounts.map((account) => ({
              accountId: AccountIdSchema.parse(account.id),
              accountAlias: account.alias,
              playerAlias: player.alias,
              guildId: player.serverId,
            })),
          );
          return {
            kind: "challenge_accounts",
            message:
              accounts.length === 0
                ? "No linked Riot accounts are available."
                : "Use only these account IDs for a historical preview.",
            data: accounts,
          };
        }),
    }),
    draft_challenge_contract: tool({
      description:
        "Validate and save a private typed challenge draft. The frozen contract is the only evaluator; subjective or unobservable rules are invalid.",
      inputSchema: z.strictObject({
        contract: ChallengeContractV1Schema,
        sourceTemplateId: z.uuid().optional(),
      }),
      outputSchema: ChallengeToolResultSchema,
      execute: (input) =>
        options.track("draft_challenge_contract", async () => {
          const draft = await validateChallengeDraft(prisma, {
            ownerDiscordId: options.requesterId,
            contract: input.contract,
            ...(input.sourceTemplateId === undefined
              ? {}
              : { sourceTemplateId: input.sourceTemplateId }),
          });
          return {
            kind: "challenge_draft",
            message:
              "The private challenge draft is valid. Preview it before asking the user to publish.",
            data: draft,
          };
        }),
    }),
    preview_challenge_draft: tool({
      description:
        "Preview a saved challenge draft against Scout-known history for selected linked accounts. This never publishes or starts a run.",
      inputSchema: z.strictObject({
        draftId: z.uuid(),
        accountIds: AccountIdSchema.array().min(1),
        startAt: z.iso.datetime(),
        endAt: z.iso.datetime(),
      }),
      outputSchema: ChallengeToolResultSchema,
      execute: (input) =>
        options.track("preview_challenge_draft", async () => {
          const preview = await previewChallengeDraft(prisma, {
            ownerDiscordId: options.requesterId,
            draftId: input.draftId,
            accountIds: input.accountIds,
            startAt: new Date(input.startAt),
            endAt: new Date(input.endAt),
          });
          return {
            kind: "challenge_preview",
            message:
              "Preview complete. Publication still requires the user's explicit confirmation in the web app.",
            data: {
              ...preview,
              confirmationPath: `/app/challenges/drafts/${input.draftId}`,
            },
          };
        }),
    }),
  };
}
