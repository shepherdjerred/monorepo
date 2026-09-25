import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageCreateOptions,
} from "discord.js";
import { ApplicationFailure } from "@temporalio/common";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  RiotMatchIdSchema,
  S3ObjectKeySchema,
  Sha256DigestSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { MatchIdSchema } from "@scout-for-lol/data";

/**
 * The postmatch render takes v1's built message apart and the postmatch
 * delivery puts it back together from what the receipt attested. The
 * property that matters is the round trip: rebuilt from the parts, the
 * message is the one the generator built — and the disassembly refuses any
 * message it could not describe truthfully, because a receipt that omitted
 * an attachment or a component would attest a message nobody delivered.
 */

const stubs = vi.hoisted(() => ({
  resolveScoutV2ObservedMatchContext: vi.fn(),
  resolvePostmatchDeliveryChannels: vi.fn(),
  generateMatchReport: vi.fn(),
}));

vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2ObservedMatchContext: stubs.resolveScoutV2ObservedMatchContext,
}));
vi.mock("#src/league/tasks/notification-filters.ts", () => ({
  resolvePostmatchDeliveryChannels: stubs.resolvePostmatchDeliveryChannels,
}));
vi.mock("#src/league/tasks/postmatch/match-report-generator.ts", () => ({
  generateMatchReport: stubs.generateMatchReport,
}));

const { buildPostmatchNotificationMessageV2, renderPostmatchNotificationV2 } =
  await import("#src/temporal/v2/notification/postmatch-notification.ts");
const { matchLinkComponents } =
  await import("#src/league/tasks/postmatch/match-report-components.ts");
const { withMvpVoteFurniture } = await import("#src/mvp-votes/components.ts");

const RIOT_MATCH = RiotMatchIdSchema.parse("NA1_9301");
const MATCH = MatchIdSchema.parse("NA1_9301");
const IMAGE = new Uint8Array([137, 80, 78, 71, 1]);
const REVIEW = new Uint8Array([137, 80, 78, 71, 2, 2]);
const LIVE = { kind: "live" } as const;

function reportEmbed(): EmbedBuilder {
  return new EmbedBuilder({ image: { url: `attachment://${MATCH}.png` } });
}

/** A standard-queue report exactly as v1's generator builds one. */
function standardReport(review: boolean): MessageCreateOptions {
  const files = [
    new AttachmentBuilder(Buffer.from(IMAGE)).setName(`${MATCH}.png`),
  ];
  if (review) {
    files.push(
      new AttachmentBuilder(Buffer.from(REVIEW)).setName("ai-review.png"),
    );
  }
  return {
    content: review
      ? "jerred finished a solo game\n\nA clean carry."
      : "jerred finished a solo game",
    files,
    embeds: [reportEmbed()],
    components: matchLinkComponents(MATCH),
  };
}

/** An Arena or Classic report: no link button. */
function reportWithoutLink(): MessageCreateOptions {
  return {
    content: "jerred finished an arena game",
    files: [new AttachmentBuilder(Buffer.from(IMAGE)).setName(`${MATCH}.png`)],
    embeds: [reportEmbed()],
  };
}

const GuildIdsSchema = z.object({ targetGuildIds: z.array(z.string()) });

beforeEach(() => {
  vi.clearAllMocks();
  stubs.resolveScoutV2ObservedMatchContext.mockResolvedValue({
    matchId: MATCH,
    riotMatchId: RIOT_MATCH,
    matchData: {
      info: {
        queueId: 420,
        gameMode: "CLASSIC",
        gameType: "MATCHED_GAME",
        gameCreation: 1_789_000_000_000,
      },
    },
    trackedPlayers: [
      { alias: "jerred", league: { leagueAccount: { puuid: "p".repeat(78) } } },
    ],
  });
  stubs.resolvePostmatchDeliveryChannels.mockResolvedValue({
    subscribed: [],
    deliverable: [],
    guildIds: ["300000000000000003", "300000000000000004"],
  });
  stubs.generateMatchReport.mockResolvedValue(standardReport(true));
});

describe("the round trip", () => {
  test.each([
    { name: "a standard report with a review", message: standardReport(true) },
    {
      name: "a standard report without a review",
      message: standardReport(false),
    },
    { name: "a report without a link button", message: reportWithoutLink() },
    {
      name: "a Flex report with MVP vote furniture",
      message: withMvpVoteFurniture(standardReport(false), MATCH),
    },
  ])("rebuilds $name exactly as the generator built it", async (scenario) => {
    stubs.generateMatchReport.mockResolvedValue(scenario.message);

    const rendered = await renderPostmatchNotificationV2(RIOT_MATCH, LIVE);
    const rebuilt = buildPostmatchNotificationMessageV2(RIOT_MATCH, {
      image: rendered.image,
      review: rendered.review,
      evidence: {
        artifact: "report",
        riotMatchId: RIOT_MATCH,
        image: {
          objectKey: S3ObjectKeySchema.parse(
            "games/2026/09/16/NA1_9301/report.png",
          ),
          digest: Sha256DigestSchema.parse("f".repeat(64)),
          bytes: IMAGE.byteLength,
          contentType: "image/png",
        },
        content: rendered.content,
        components: rendered.components,
      },
    });

    // JSON is what Discord receives: builders serialize through toJSON.
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(scenario.message));
    // `Uint8Array.from` normalizes the Node Buffer the builder holds: what
    // matters is that the bytes committed are the bytes v1 attached.
    expect(Uint8Array.from(rendered.image)).toEqual(IMAGE);
    expect(rendered.queueId).toBe(420);
  });
});

describe("what the render evaluates", () => {
  test("generates the report against every guild the match's report goes to", async () => {
    // The AI review is gated per guild and spent once per match; the render
    // evaluates the gate against the whole audience, as v1 does, so no
    // channel's review depends on which child rendered first.
    await renderPostmatchNotificationV2(RIOT_MATCH, LIVE);

    expect(stubs.resolvePostmatchDeliveryChannels).toHaveBeenCalledWith({
      puuids: ["p".repeat(78)],
      queueType: "solo",
    });
    const options = GuildIdsSchema.parse(
      stubs.generateMatchReport.mock.calls[0]?.[2],
    );
    expect(options.targetGuildIds).toEqual([
      "300000000000000003",
      "300000000000000004",
    ]);
  });

  test("a live render captures ranks; a historical one is handed the recorded changes", async () => {
    // A live render runs minutes after the game, so the rank the generator
    // captures IS the post-game rank. A historical render runs long after,
    // and must not re-capture: it would upsert today's rank over the row the
    // settlement-time capture wrote for that game.
    const recorded = new Map([
      ["p".repeat(78), { before: undefined, after: undefined }],
    ]);
    await renderPostmatchNotificationV2(RIOT_MATCH, LIVE);
    await renderPostmatchNotificationV2(RIOT_MATCH, {
      kind: "historical",
      rankChanges: recorded,
    });

    const [live, historical] = stubs.generateMatchReport.mock.calls.map(
      (call) => z.record(z.string(), z.unknown()).parse(call[2]),
    );
    expect(live).not.toHaveProperty("prefetchedRankChanges");
    expect(live).not.toHaveProperty("omitMvpVotes");
    expect(historical?.["prefetchedRankChanges"]).toBe(recorded);
    // A report nobody will see gets no vote controls and no contest.
    expect(historical?.["omitMvpVotes"]).toBe(true);
  });

  test("reports the game's creation instant for dating its objects", async () => {
    const rendered = await renderPostmatchNotificationV2(RIOT_MATCH, LIVE);
    expect(rendered.gameCreation).toBe(1_789_000_000_000);
  });

  test("a report the generator cannot build is non-retryable", async () => {
    stubs.generateMatchReport.mockResolvedValue(undefined);

    await expect(
      renderPostmatchNotificationV2(RIOT_MATCH, LIVE),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ApplicationFailure && error.nonRetryable === true,
    );
  });
});

describe("what the disassembly refuses", () => {
  test.each([
    {
      name: "an attachment under a name it does not know",
      message: {
        ...standardReport(false),
        files: [
          ...(standardReport(false).files ?? []),
          new AttachmentBuilder(Buffer.from(REVIEW)).setName("extra.png"),
        ],
      },
      reason: /attachment named extra\.png/u,
    },
    {
      name: "a message with no report image",
      message: { ...standardReport(false), files: [] },
      reason: /no report image/u,
    },
    {
      name: "a message with no content line",
      message: { ...standardReport(false), content: undefined },
      reason: /no content line/u,
    },
    {
      name: "an embed the delivery would not rebuild",
      message: {
        ...standardReport(false),
        embeds: [reportEmbed(), new EmbedBuilder({ title: "extra" })],
      },
      reason: /embeds other than/u,
    },
    {
      name: "components other than the match link",
      message: {
        ...standardReport(false),
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel("Elsewhere")
              .setURL("https://example.com/"),
          ),
        ],
      },
      reason: /components other than the match link/u,
    },
  ])("refuses $name", async (scenario) => {
    stubs.generateMatchReport.mockResolvedValue(scenario.message);

    await expect(
      renderPostmatchNotificationV2(RIOT_MATCH, LIVE),
    ).rejects.toThrow(scenario.reason);
  });
});
