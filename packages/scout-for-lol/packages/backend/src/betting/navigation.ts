import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import {
  BucksLedgerContextSchema,
  BucksPoolRosterSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type BucksLedgerKind,
  formatInteger,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import {
  getLedgerPage,
  type LedgerPage,
  type LedgerPageEntry,
} from "#src/betting/accounts.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { BUCKS_GUILD_ONLY, BUCKS_NOT_ENABLED } from "#src/betting/copy.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { BucksButtonEditReplyOptions } from "#src/betting/bet-button.ts";
import { WeeklyParlaySubjectsSchema } from "#src/betting/weekly-parlay-criteria.ts";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";

export const BUCKS_NAVIGATION_NAMESPACE = "bbnav";
export const BUCKS_NAVIGATION_VERSION = "1";

const LEDGER_KIND_LABELS = {
  seed: "welcome grant",
  earn_game: "game played",
  earn_ranked_5s_bonus: "Ranked 5s bonus",
  earn_clash_bonus: "Clash bonus",
  earn_win: "game won",
  earn_mvp: "game MVP",
  bet_stake: "bet offer reserved",
  bet_payout: "gross bet payout",
  bet_unmatched_refund: "unmatched offer refunded",
  bet_cancel_refund: "cancelled offer refunded",
  bet_void_refund: "matched stake refunded",
  winner_fee: "winner fee",
  house_match: "house match reserved",
  bet_refund: "bet refunded",
  house_rake: "house cut on payout",
  cancel_fee: "cancellation fee",
  parlay_stake: "parlay stake",
  parlay_reserve: "parlay house reserve",
  parlay_payout: "parlay payout",
  parlay_refund: "parlay refund",
  parlay_release: "parlay reserve release",
  weekly_parlay_stake: "weekly parlay stake",
  weekly_parlay_reserve: "weekly parlay house reserve",
  weekly_parlay_payout: "weekly parlay payout",
  weekly_parlay_refund: "weekly parlay refund",
  weekly_parlay_release: "weekly parlay reserve release",
  // Retired feature; the label survives so historical rows stay readable.
  peek_pass: "24-hour peek pass",
  transfer_sent: "transfer sent",
  transfer_received: "transfer received",
  transfer_fee: "transfer fee",
  dare_stake: "dare pot contribution",
  dare_payout: "dare bounty payout",
  dare_refund: "dare refund",
  dare_fee: "dare fee",
  adjustment: "adjustment",
} satisfies Record<BucksLedgerKind, string>;

export function ledgerKindLabel(kind: BucksLedgerKind): string {
  return LEDGER_KIND_LABELS[kind];
}

/**
 * At most this many names per row. Capping the *count* is not enough on its
 * own: `PlayerAliasSchema` allows aliases up to 100 characters, so three of
 * them can still run past a thousand characters on a single row. The
 * character cap below is what actually keeps ten rows inside Discord's 2000-
 * character content limit.
 */
const MAX_GAME_LABEL_ALIASES = 3;
/** Character budget for one row's alias list, chosen so ten rows plus the
 * kind label, amounts, and header stay comfortably under Discord's limit. */
const MAX_GAME_LABEL_CHARS = 60;

function formatGameLabel(aliases: readonly string[]): string | undefined {
  const unique = [...new Set(aliases)];
  if (unique.length === 0) {
    return undefined;
  }
  const shown = unique.slice(0, MAX_GAME_LABEL_ALIASES);
  const hidden = unique.length - shown.length;
  const label =
    hidden > 0
      ? `${shown.join(", ")} +${formatInteger(hidden)}`
      : shown.join(", ");
  return label.length > MAX_GAME_LABEL_CHARS
    ? `${label.slice(0, MAX_GAME_LABEL_CHARS).trimEnd()}…`
    : label;
}

function parsedContext(entry: LedgerPageEntry) {
  try {
    return BucksLedgerContextSchema.safeParse(JSON.parse(entry.context)).data;
  } catch {
    // Historical rows predate some context shapes; an unreadable one simply
    // falls back to the match ID.
    return;
  }
}

type LedgerContext = ReturnType<typeof parsedContext>;

/** Outcome-bet contexts carry the frozen sides; no lookup needed. */
function contextAliasLabel(context: LedgerContext): string | undefined {
  if (
    context?.type === "stake" ||
    context?.type === "settlement" ||
    context?.type === "matching" ||
    context?.type === "cancellation"
  ) {
    return formatGameLabel([
      ...context.backedAliases,
      ...context.opposingAliases,
    ]);
  }
  // Dare contexts carry their frozen target aliases; dares have no pool, so
  // a dare_payout's match ID must never fall through to the roster lookup.
  if (context?.type === "dare") {
    return formatGameLabel(context.targetAliases);
  }
  return;
}

function needsRosterLookup(context: LedgerContext): boolean {
  return (
    context?.type === "earn" ||
    context?.type === "earn_prematch" ||
    context?.type === "parlay_stake" ||
    context?.type === "parlay_reserve" ||
    context?.type === "parlay_settlement"
  );
}

function weeklyDefinitionId(context: LedgerContext): number | undefined {
  if (
    context?.type === "weekly_parlay_stake" ||
    context?.type === "weekly_parlay_reserve" ||
    context?.type === "weekly_parlay_settlement"
  ) {
    return context.definitionId;
  }
  return;
}

async function loadRosterLabels(
  serverId: DiscordGuildId,
  matchIds: ReadonlySet<string>,
  prismaClient: ExtendedPrismaClient,
): Promise<Map<string, string | undefined>> {
  const labels = new Map<string, string | undefined>();
  if (matchIds.size === 0) {
    return labels;
  }
  const pools = await prismaClient.bucksMatchPool.findMany({
    where: { serverId, matchId: { in: [...matchIds] } },
    select: { matchId: true, roster: true },
  });
  for (const pool of pools) {
    const roster = BucksPoolRosterSchema.safeParse(JSON.parse(pool.roster));
    const tracked =
      roster.data?.participants.flatMap((participant) =>
        participant.trackedAlias === undefined
          ? []
          : [participant.trackedAlias],
      ) ?? [];
    labels.set(pool.matchId, formatGameLabel(tracked));
  }
  return labels;
}

async function loadWeeklySubjectLabels(
  serverId: DiscordGuildId,
  definitionIds: ReadonlySet<number>,
  prismaClient: ExtendedPrismaClient,
): Promise<Map<number, string | undefined>> {
  const labels = new Map<number, string | undefined>();
  if (definitionIds.size === 0) {
    return labels;
  }
  const definitions = await prismaClient.bucksWeeklyParlayDefinition.findMany({
    where: { serverId, id: { in: [...definitionIds] } },
    select: { id: true, subjects: true },
  });
  for (const definition of definitions) {
    const subjects = WeeklyParlaySubjectsSchema.safeParse(
      JSON.parse(definition.subjects),
    );
    labels.set(
      definition.id,
      formatGameLabel(subjects.data?.map((subject) => subject.alias) ?? []),
    );
  }
  return labels;
}

/**
 * Who was in the game behind each ledger row, so `/bb history` reads
 * "bet offer reserved · jerred, bryan" instead of a raw Riot match ID.
 *
 * Outcome-bet rows answer from their frozen context alone. Earn and parlay
 * rows carry only a match ID, which resolves through the pool's frozen roster;
 * weekly-parlay rows span matches and resolve through their definition's
 * frozen subjects. Anything that cannot resolve keeps the match ID — a worse
 * label beats a missing audit line.
 */
export async function resolveLedgerGameLabels(
  serverId: DiscordGuildId,
  entries: readonly LedgerPageEntry[],
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<ReadonlyMap<number, string>> {
  const contexts = new Map(
    entries.map((entry) => [entry.id, parsedContext(entry)]),
  );
  const { labels, rosterMatchIds, definitionIds } = collectLabelSources(
    entries,
    contexts,
  );
  const aliasesByMatchId = await loadRosterLabels(
    serverId,
    rosterMatchIds,
    prismaClient,
  );
  const subjectsByDefinitionId = await loadWeeklySubjectLabels(
    serverId,
    definitionIds,
    prismaClient,
  );
  applyLookupLabels({
    entries,
    contexts,
    labels,
    aliasesByMatchId,
    subjectsByDefinitionId,
  });
  return labels;
}

function collectLabelSources(
  entries: readonly LedgerPageEntry[],
  contexts: ReadonlyMap<number, LedgerContext>,
): {
  labels: Map<number, string>;
  rosterMatchIds: Set<string>;
  definitionIds: Set<number>;
} {
  const labels = new Map<number, string>();
  const rosterMatchIds = new Set<string>();
  const definitionIds = new Set<number>();
  for (const entry of entries) {
    const context = contexts.get(entry.id);
    const fromContext = contextAliasLabel(context);
    if (fromContext !== undefined) {
      labels.set(entry.id, fromContext);
      continue;
    }
    if (needsRosterLookup(context) && entry.matchId !== null) {
      rosterMatchIds.add(entry.matchId);
    }
    const definitionId = weeklyDefinitionId(context);
    if (definitionId !== undefined) {
      definitionIds.add(definitionId);
    }
  }
  return { labels, rosterMatchIds, definitionIds };
}

function applyLookupLabels(input: {
  entries: readonly LedgerPageEntry[];
  contexts: ReadonlyMap<number, LedgerContext>;
  labels: Map<number, string>;
  aliasesByMatchId: ReadonlyMap<string, string | undefined>;
  subjectsByDefinitionId: ReadonlyMap<number, string | undefined>;
}): void {
  for (const entry of input.entries) {
    if (input.labels.has(entry.id)) {
      continue;
    }
    const fromRoster =
      entry.matchId === null
        ? undefined
        : input.aliasesByMatchId.get(entry.matchId);
    if (fromRoster !== undefined) {
      input.labels.set(entry.id, fromRoster);
      continue;
    }
    const definitionId = weeklyDefinitionId(input.contexts.get(entry.id));
    const fromDefinition =
      definitionId === undefined
        ? undefined
        : input.subjectsByDefinitionId.get(definitionId);
    if (fromDefinition !== undefined) {
      input.labels.set(entry.id, `weekly · ${fromDefinition}`);
    }
  }
}

const BucksNavigationIdSchema = z.strictObject({
  action: z.literal("h"),
  ownerId: DiscordAccountIdSchema,
  snapshotId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  page: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export type BucksNavigationId = z.infer<typeof BucksNavigationIdSchema>;

export function formatBucksNavigationId(input: BucksNavigationId): string {
  const parsed = BucksNavigationIdSchema.parse(input);
  const customId = [
    BUCKS_NAVIGATION_NAMESPACE,
    BUCKS_NAVIGATION_VERSION,
    parsed.action,
    parsed.ownerId,
    parsed.snapshotId.toString(),
    parsed.page.toString(),
  ].join(":");
  if (customId.length > 100) {
    throw new Error(
      `Bryan Bucks navigation ID exceeds Discord's 100-character limit: ${customId}`,
    );
  }
  return customId;
}

const EXPECTED_SEGMENTS = 6;

export function parseBucksNavigationId(
  raw: string,
): BucksNavigationId | undefined {
  const segments = raw.split(":");
  if (segments.length !== EXPECTED_SEGMENTS) {
    return undefined;
  }
  const [namespace, version, action, ownerId, snapshotId, page] = segments;
  if (
    namespace !== BUCKS_NAVIGATION_NAMESPACE ||
    version !== BUCKS_NAVIGATION_VERSION
  ) {
    return undefined;
  }
  const result = BucksNavigationIdSchema.safeParse({
    action,
    ownerId,
    snapshotId: Number(snapshotId),
    page: Number(page),
  });
  return result.success ? result.data : undefined;
}

export function isBucksNavigationId(raw: string): boolean {
  return raw.startsWith(`${BUCKS_NAVIGATION_NAMESPACE}:`);
}

function navigationRow(
  ownerId: ReturnType<typeof DiscordAccountIdSchema.parse>,
  page: LedgerPage,
): ActionRowBuilder<ButtonBuilder>[] {
  if (page.snapshotId === null || page.totalPages <= 1) {
    return [];
  }

  const previousPage = Math.max(page.page - 1, 0);
  const nextPage = Math.min(page.page + 1, page.totalPages - 1);
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          formatBucksNavigationId({
            action: "h",
            ownerId,
            snapshotId: page.snapshotId,
            page: previousPage,
          }),
        )
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page.page === 0),
      new ButtonBuilder()
        .setCustomId(
          formatBucksNavigationId({
            action: "h",
            ownerId,
            snapshotId: page.snapshotId,
            page: nextPage,
          }),
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page.page >= page.totalPages - 1),
    ),
  ];
}

export function renderBucksHistory(
  ownerId: ReturnType<typeof DiscordAccountIdSchema.parse>,
  page: LedgerPage,
  gameLabels?: ReadonlyMap<number, string>,
): BucksButtonEditReplyOptions {
  if (page.entries.length === 0) {
    return {
      content: "No Bryan Bucks history yet.",
      components: [],
    };
  }

  const lines = page.entries.map((entry) => {
    const sign = entry.delta > 0 ? "+" : "";
    // Tracked players in the game, falling back to the raw match ID for rows
    // whose pool or definition is no longer resolvable.
    const label = gameLabels?.get(entry.id) ?? entry.matchId;
    const where = label === null ? "" : ` · ${label}`;
    return `\`${sign}${formatInteger(entry.delta)}\` ${ledgerKindLabel(entry.kind)}${where} → ${formatInteger(entry.balanceAfter)} BB`;
  });
  return {
    // The per-row character cap above keeps this well under Discord's limit
    // in the ordinary case; this is the backstop for the shape it doesn't
    // cover — a match ID fallback or a wide kind label on every one of the
    // page's ten rows.
    content: truncateDiscordMessage(
      [
        `**Bryan Bucks history** · Page ${formatInteger(page.page + 1)}/${formatInteger(page.totalPages)}`,
        ...lines,
      ].join("\n"),
    ),
    components: navigationRow(ownerId, page),
  };
}

export type BucksNavigationInteraction = {
  customId: string;
  guildId: string | null;
  user: { id: string };
  deferReply: (options: { ephemeral: true }) => Promise<unknown>;
  deferUpdate: () => Promise<unknown>;
  editReply: (options: BucksButtonEditReplyOptions) => Promise<unknown>;
};

export async function handleBucksNavigation(
  interaction: BucksNavigationInteraction,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const navigation = parseBucksNavigationId(interaction.customId);
  if (navigation === undefined) {
    await interaction.deferUpdate();
    return;
  }
  if (interaction.guildId === null) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: BUCKS_GUILD_ONLY,
      components: [],
    });
    return;
  }

  const clickerId = DiscordAccountIdSchema.parse(interaction.user.id);
  if (clickerId !== navigation.ownerId) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content:
        "Only the person who opened this history can use these controls.",
    });
    return;
  }

  const serverId = DiscordGuildIdSchema.parse(interaction.guildId);
  if (!(await isPolicyEnabled("betting_enabled", { server: serverId }))) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: BUCKS_NOT_ENABLED,
      components: [],
    });
    return;
  }

  await interaction.deferUpdate();
  const page = await getLedgerPage(
    {
      serverId,
      discordId: clickerId,
      page: navigation.page,
      snapshotId: navigation.snapshotId,
    },
    prismaClient,
  );
  const gameLabels = await resolveLedgerGameLabels(
    serverId,
    page.entries,
    prismaClient,
  );
  await interaction.editReply(renderBucksHistory(clickerId, page, gameLabels));
}
