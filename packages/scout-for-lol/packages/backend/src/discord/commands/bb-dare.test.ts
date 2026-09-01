import { describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
} from "@scout-for-lol/data";
import type { DareConditions } from "#src/betting/dare-criteria.ts";
import type {
  DareTranslationRecord,
  DareTranslationResult,
} from "#src/betting/dare-translate.ts";
import { bbCommand } from "#src/discord/commands/bb-definition.ts";
import { isPublicBbSubcommand } from "#src/discord/commands/bb.ts";
import {
  describeDareTranslationFailure,
  replyBbDare,
} from "#src/discord/commands/bb-dare.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb-interaction.ts";
import { bbInteractionAckMocks } from "#src/testing/bb-interaction-mocks.ts";

const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const CHALLENGER = DiscordAccountIdSchema.parse("160509172704739328");
const TARGET = DiscordAccountIdSchema.parse("160509172704739329");
const CHANNEL = "1337623164146155594";

const CONDITIONS: DareConditions = {
  version: 1,
  root: {
    kind: "all",
    clauses: [
      {
        kind: "all",
        children: [
          {
            kind: "condition",
            requiredGames: 7,
            predicate: {
              kind: "participant_boolean",
              field: "win",
              expected: true,
            },
            champion: "Warwick",
          },
        ],
      },
    ],
  },
};

const RECORD: DareTranslationRecord = {
  promptVersion: "test-prompt-1",
  model: "test-model",
  usage: {
    tokens: {
      input: 10,
      output: 20,
      cachedInput: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 30,
    },
    actualCostUsd: 0,
    catalogCostUsd: 0,
    upstreamCostUsd: 0,
  },
  shortlistKeys: ["T1"],
  rawOutput: {
    unmappable: false,
    unmappableReason: null,
    targets: ["T1"],
    horizonKind: "window",
    windowDays: 7,
    rootCombinator: "all",
    clauseCombinators: ["all"],
    leaves: [
      {
        clauseIndex: 0,
        requiredGames: 7,
        kind: "participant_boolean",
        numericField: null,
        booleanField: "win",
        rateField: null,
        operator: null,
        threshold: null,
        thresholdScaled: null,
        expected: true,
        champion: "Warwick",
      },
    ],
  },
};

const TRANSLATED: DareTranslationResult = {
  kind: "translated",
  targets: [
    {
      key: "T1",
      discordId: TARGET,
      playerId: PlayerIdSchema.parse(1),
      alias: "Virmel",
      accounts: [
        { puuid: "puuid-1", trackingStartedAt: "2026-01-01T00:00:00.000Z" },
      ],
    },
  ],
  horizonKind: "window",
  windowDays: 7,
  conditions: CONDITIONS,
  record: RECORD,
};

const PROPOSAL_EXPIRES = new Date("2026-09-01T12:00:00.000Z");

function makeCreateDare() {
  return vi.fn(() =>
    Promise.resolve({
      kind: "created" as const,
      dareId: 7,
      conditionSummary: "at least 7 games where Virmel wins on Warwick",
      proposalExpiresAt: PROPOSAL_EXPIRES,
    }),
  );
}

function fakeInteraction(input?: {
  amount?: number;
  channelId?: string | null;
}): BbCommandInteraction {
  return {
    id: "bb-dare-test",
    guildId: SERVER,
    channelId: input?.channelId === undefined ? CHANNEL : input.channelId,
    user: { id: CHALLENGER },
    options: {
      getSubcommand: () => "dare",
      getString: () => "I bet Virmel can't win 7 games on Warwick",
      getInteger: () => input?.amount ?? 10,
      getUser: () => ({ id: TARGET, bot: false }),
    },
    ...bbInteractionAckMocks(true),
    followUp: vi.fn(() => Promise.resolve(undefined)),
  };
}

describe("/bb dare", () => {
  test("registers a bounded free-text dare and whole-BB amount", () => {
    const dare = bbCommand
      .toJSON()
      .options?.find((option) => option.name === "dare");
    if (dare === undefined || !("options" in dare)) {
      throw new Error("/bb dare should be a subcommand with options");
    }
    expect(dare.options).toEqual([
      expect.objectContaining({
        name: "dare",
        required: true,
        type: 3,
        max_length: 400,
      }),
      expect.objectContaining({
        name: "amount",
        required: true,
        type: 4,
        min_value: 1,
        max_value: 2_147_483_647,
      }),
    ]);
    expect(isPublicBbSubcommand("dare")).toBe(false);
  });

  test("refuses when the dares flag is off, before any translation", async () => {
    const interaction = fakeInteraction();
    const translate = vi.fn();
    await replyBbDare(interaction, SERVER, CHALLENGER, {
      isDaresPolicyEnabled: () => Promise.resolve(false),
      translate,
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "🚫 Bryan Bucks dares aren't enabled in this server.",
    });
    expect(translate).not.toHaveBeenCalled();
  });

  test("answers the friendlier insufficient error before translating", async () => {
    const interaction = fakeInteraction({ amount: 10 });
    const translate = vi.fn();
    await replyBbDare(interaction, SERVER, CHALLENGER, {
      isDaresPolicyEnabled: () => Promise.resolve(true),
      loadDareBalance: () => Promise.resolve(3),
      translate,
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "💸 You have **3 BB** but need **10 BB**.",
    });
    expect(translate).not.toHaveBeenCalled();
  });

  test("a broken balance read never blocks the dare", async () => {
    const interaction = fakeInteraction();
    const createDare = makeCreateDare();
    await replyBbDare(interaction, SERVER, CHALLENGER, {
      isDaresPolicyEnabled: () => Promise.resolve(true),
      loadDareBalance: () => Promise.reject(new Error("database down")),
      translate: () => Promise.resolve(TRANSLATED),
      createDare,
    });
    expect(createDare).toHaveBeenCalledTimes(1);
  });

  test("maps every translation failure to friendly ephemeral copy", () => {
    expect(
      describeDareTranslationFailure({
        kind: "unmappable",
        reason: "Nobody named Steve is tracked here.",
      }),
    ).toBe(
      "🤔 I can't turn that into a dare: Nobody named Steve is tracked here.",
    );
    expect(describeDareTranslationFailure({ kind: "timeout" })).toBe(
      "⏳ The dare translator took too long. Try again in a moment.",
    );
    expect(describeDareTranslationFailure({ kind: "budget_refused" })).toBe(
      "🧯 The dare translator is out of budget right now. Try again later.",
    );
    expect(describeDareTranslationFailure({ kind: "invalid_output" })).toBe(
      "🤖 The translator couldn't produce a usable dare from that. Try rewording it.",
    );
    expect(describeDareTranslationFailure({ kind: "provider_error" })).toBe(
      "😵 The dare translator failed. Try again shortly.",
    );
  });

  test("shows the unmappable reason through the handler", async () => {
    const interaction = fakeInteraction();
    await replyBbDare(interaction, SERVER, CHALLENGER, {
      isDaresPolicyEnabled: () => Promise.resolve(true),
      loadDareBalance: () => Promise.resolve(undefined),
      translate: () =>
        Promise.resolve({
          kind: "unmappable" as const,
          reason: "Maintain-every-game claims are not supported.",
        }),
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        "🤔 I can't turn that into a dare: Maintain-every-game claims are not supported.",
    });
  });

  test("lists domain issues when the proposal is invalid", async () => {
    const interaction = fakeInteraction();
    await replyBbDare(interaction, SERVER, CHALLENGER, {
      isDaresPolicyEnabled: () => Promise.resolve(true),
      loadDareBalance: () => Promise.resolve(undefined),
      translate: () => Promise.resolve(TRANSLATED),
      createDare: () =>
        Promise.resolve({
          kind: "invalid" as const,
          issues: ["A dare names between 1 and 5 targets"],
        }),
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: [
        "🚫 That dare can't be created:",
        "• A dare names between 1 and 5 targets",
      ].join("\n"),
    });
  });

  test("creates the proposal and shows the confirmation with bbd buttons", async () => {
    const interaction = fakeInteraction({ amount: 10 });
    const createDare = makeCreateDare();
    await replyBbDare(interaction, SERVER, CHALLENGER, {
      isDaresPolicyEnabled: () => Promise.resolve(true),
      loadDareBalance: () => Promise.resolve(100),
      translate: () => Promise.resolve(TRANSLATED),
      createDare,
    });

    expect(createDare).toHaveBeenCalledWith({
      serverId: SERVER,
      channelId: CHANNEL,
      challengerDiscordId: CHALLENGER,
      originalText: "I bet Virmel can't win 7 games on Warwick",
      translation: JSON.stringify(RECORD),
      conditions: CONDITIONS,
      horizonKind: "window",
      windowDays: 7,
      amount: 10,
      targets: [
        {
          discordId: TARGET,
          playerId: PlayerIdSchema.parse(1),
          alias: "Virmel",
          accounts: [
            { puuid: "puuid-1", trackingStartedAt: "2026-01-01T00:00:00.000Z" },
          ],
        },
      ],
    });

    const editReply = vi.mocked(interaction.editReply);
    const lastCall = editReply.mock.calls.at(-1)?.[0];
    if (
      lastCall === undefined ||
      typeof lastCall === "string" ||
      !("components" in lastCall)
    ) {
      throw new Error("The confirmation should carry components");
    }
    const serialized = JSON.stringify(lastCall);
    expect(serialized).toContain("bbd:1:c:7");
    expect(serialized).toContain("bbd:1:n:7");
    expect(serialized).toContain(
      "at least 7 games where Virmel wins on Warwick",
    );
    expect(serialized).toContain("Confirm before");
  });
});
