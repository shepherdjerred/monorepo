import { differenceInCalendarWeeks } from "date-fns";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  WEEKLY_PARLAY_CATALOG_VERSION,
  WEEKLY_PARLAY_ELIGIBLE_QUEUES,
  WEEKLY_PARLAY_EVALUATOR_VERSION,
  WEEKLY_PARLAY_PRICING_VERSION,
  WEEKLY_PARLAY_SCHEMA_VERSION,
  WeeklyParlaySubjectsSchema,
  validateWeeklyParlayProposal,
} from "#src/betting/weekly/weekly-parlay-criteria.ts";
import {
  fetchWeeklyCandidateHistories,
  type WeeklyParlayCandidateHistory,
} from "#src/betting/weekly/weekly-parlay-history.ts";
import {
  generateWeeklyParlayProposals,
  WEEKLY_PARLAY_PROMPT_VERSION,
} from "#src/betting/weekly/weekly-parlay-model.ts";
import {
  isWeeklyParlayCatchupTimeline,
  WEEKLY_PARLAY_SLOT,
  weeklyParlayScoringShape,
  weeklyParlayPeriod,
  type WeeklyParlayFrozenWindow,
} from "#src/betting/weekly/weekly-parlay-period.ts";
import {
  priceWeeklyParlayProposals,
  type WeeklyParlayPricing,
} from "#src/betting/weekly/weekly-parlay-pricing.ts";
import { orderWeeklyParlayCandidates } from "#src/betting/weekly/weekly-parlay-selection.ts";
import { loadWeeklyParlaySubjects } from "#src/betting/weekly/weekly-parlay-subjects.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { isUniqueConstraintError } from "#src/lib/player-admin/shared.ts";
import {
  bettingWeeklyParlayGenerationDurationSeconds,
  bettingWeeklyParlayGenerationTotal,
} from "#src/metrics/betting-weekly-parlay.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";

export type OpenWeeklyParlayResult =
  | { kind: "created" | "existing"; marketId: number }
  | {
      kind: "feature_disabled" | "no_candidate" | "no_price" | "too_late";
    };

function periodsSinceFeatured(
  current: string,
  previous: string | undefined,
): number | null {
  return previous === undefined
    ? null
    : differenceInCalendarWeeks(new Date(current), new Date(previous), {
        weekStartsOn: 1,
      });
}

function openActionIsActive(
  period: Pick<WeeklyParlayFrozenWindow, "bettingClosesAt">,
  signal: AbortSignal | undefined,
  generationDeadline: Date | undefined,
): boolean {
  if (signal?.aborted === true) {
    throw signal.reason ?? new Error("Weekly parlay open was aborted.");
  }
  return (
    new Date() < period.bettingClosesAt &&
    (generationDeadline === undefined ||
      generationDeadline.getTime() < period.bettingClosesAt.getTime())
  );
}

type OpenWeeklyParlayInput = {
  serverId: string;
  periodKey: string;
  slot?: number;
  timeline?: WeeklyParlayFrozenWindow;
  generationDeadline?: Date;
  signal?: AbortSignal;
};

function resolveOpenTimeline(
  input: Pick<OpenWeeklyParlayInput, "periodKey" | "timeline">,
): WeeklyParlayFrozenWindow {
  if (input.timeline === undefined) {
    return weeklyParlayPeriod(input.periodKey);
  }
  if (input.timeline.periodKey !== input.periodKey) {
    throw new Error("Weekly parlay timeline period key does not match input.");
  }
  weeklyParlayScoringShape(input.timeline);
  return input.timeline;
}

function assertMatchingTimeline(
  existing: {
    definition: {
      openAt: Date;
      bettingClosesAt: Date;
      scoringStartsAt: Date;
      scoringEndsAt: Date;
    };
  },
  requested: WeeklyParlayFrozenWindow,
): void {
  const stored = existing.definition;
  if (
    stored.openAt.getTime() !== requested.openAt.getTime() ||
    stored.bettingClosesAt.getTime() !== requested.bettingClosesAt.getTime() ||
    stored.scoringStartsAt.getTime() !== requested.scoringStartsAt.getTime() ||
    stored.scoringEndsAt.getTime() !== requested.scoringEndsAt.getTime()
  ) {
    throw new Error(
      "Weekly parlay period and slot already exist with a conflicting timeline.",
    );
  }
}

function timelineKind(
  period: WeeklyParlayFrozenWindow,
): "standard" | "catch_up" {
  return isWeeklyParlayCatchupTimeline(period) ? "catch_up" : "standard";
}

async function generatePricedCandidate(input: {
  periodKey: string;
  history: WeeklyParlayCandidateHistory;
  signal?: AbortSignal;
}): Promise<
  | {
      generated: Awaited<ReturnType<typeof generateWeeklyParlayProposals>>;
      priced: WeeklyParlayPricing;
    }
  | undefined
> {
  if (input.history.championShortlist.length === 0) {
    return;
  }
  const championShortlists = new Map([
    [input.history.subject.key, input.history.championShortlist],
  ]);
  const eligibleChampions = new Map([
    [
      input.history.subject.key,
      new Set(
        input.history.championShortlist.map((summary) => summary.champion),
      ),
    ],
  ]);
  const generated = await generateWeeklyParlayProposals({
    periodKey: input.periodKey,
    subjects: [input.history.subject],
    championShortlists,
    historyWindows: input.history.fullyObservedWindows,
    ...(input.signal === undefined ? {} : { abortSignal: input.signal }),
  });
  const issues = generated.proposals.flatMap((proposal, index) =>
    validateWeeklyParlayProposal({
      proposal,
      subjects: [input.history.subject],
      eligibleChampions,
    }).map((issue) => `Proposal ${String(index + 1)}: ${issue}`),
  );
  if (issues.length > 0) {
    return;
  }
  const priced = priceWeeklyParlayProposals({
    proposals: generated.proposals,
    windows: input.history.windows,
  });
  return priced === undefined ? undefined : { generated, priced };
}

async function openWeeklyParlayInternal(
  input: OpenWeeklyParlayInput,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<OpenWeeklyParlayResult> {
  const serverId = DiscordGuildIdSchema.parse(input.serverId);
  const slot = input.slot ?? WEEKLY_PARLAY_SLOT;
  const period = resolveOpenTimeline(input);
  const existing = await prismaClient.bucksWeeklyParlayMarket.findUnique({
    where: {
      serverId_periodKey_slot: { serverId, periodKey: input.periodKey, slot },
    },
    select: {
      id: true,
      definition: {
        select: {
          openAt: true,
          bettingClosesAt: true,
          scoringStartsAt: true,
          scoringEndsAt: true,
        },
      },
    },
  });
  if (existing !== null) {
    assertMatchingTimeline(existing, period);
    return { kind: "existing", marketId: existing.id };
  }
  const [bettingEnabled, weeklyEnabled] = await Promise.all([
    isPolicyEnabled("betting_enabled", { server: serverId }),
    isPolicyEnabled("weekly_parlays_enabled", { server: serverId }),
  ]);
  if (!bettingEnabled || !weeklyEnabled) {
    return { kind: "feature_disabled" };
  }
  const startedAt = Date.now();
  const subjects = await loadWeeklyParlaySubjects(serverId, prismaClient);
  if (subjects.length === 0) {
    return { kind: "no_candidate" };
  }
  const [histories, previousDefinitions] = await Promise.all([
    fetchWeeklyCandidateHistories({
      periodKey: input.periodKey,
      scoringWindow: {
        scoringStartsAt: period.scoringStartsAt,
        scoringEndsAt: period.scoringEndsAt,
      },
      subjects,
      ...(input.signal === undefined ? {} : { abortSignal: input.signal }),
    }),
    prismaClient.bucksWeeklyParlayDefinition.findMany({
      where: { serverId, scoringStartsAt: { lt: period.scoringStartsAt } },
      select: { periodKey: true, subjects: true },
      orderBy: { scoringStartsAt: "desc" },
      take: 52,
    }),
  ]);
  const lastFeaturedByPlayer = new Map<number, string>();
  for (const definition of previousDefinitions) {
    for (const subject of WeeklyParlaySubjectsSchema.parse(
      JSON.parse(definition.subjects),
    )) {
      if (!lastFeaturedByPlayer.has(subject.playerId)) {
        lastFeaturedByPlayer.set(subject.playerId, definition.periodKey);
      }
    }
  }
  const historyByPlayer = new Map(
    histories.map((history) => [history.subject.playerId, history]),
  );
  const ordered = orderWeeklyParlayCandidates(
    histories.map((history) => ({
      playerId: history.subject.playerId,
      linkedGuildMember: true,
      recentEligibleGames: history.recentEligibleGames,
      fullyObservedWindows: history.fullyObservedWindows,
      periodsSinceFeatured: periodsSinceFeatured(
        input.periodKey,
        lastFeaturedByPlayer.get(history.subject.playerId),
      ),
    })),
  );
  if (ordered.length === 0) {
    return { kind: "no_candidate" };
  }
  for (const candidate of ordered) {
    const history = historyByPlayer.get(candidate.playerId);
    if (history === undefined) {
      throw new Error("Ordered weekly candidate lost its history snapshot.");
    }
    const candidateResult = await generatePricedCandidate({
      periodKey: input.periodKey,
      history,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (candidateResult === undefined) {
      continue;
    }
    const { generated, priced } = candidateResult;
    if (!openActionIsActive(period, input.signal, input.generationDeadline)) {
      return { kind: "too_late" };
    }
    try {
      const market = await prismaClient.$transaction(async (tx) => {
        const definition = await tx.bucksWeeklyParlayDefinition.create({
          data: {
            serverId,
            periodKey: input.periodKey,
            slot,
            openAt: period.openAt,
            bettingClosesAt: period.bettingClosesAt,
            scoringStartsAt: period.scoringStartsAt,
            scoringEndsAt: period.scoringEndsAt,
            subjects: JSON.stringify([history.subject]),
            eligibleQueues: JSON.stringify(WEEKLY_PARLAY_ELIGIBLE_QUEUES),
            proposal: JSON.stringify(priced.proposal),
            criteria: JSON.stringify(priced.criteria),
            historySample: JSON.stringify(history.windows),
            pricing: JSON.stringify({
              yesProbabilityBps: priced.yesProbabilityBps,
              yesWindows: priced.yesWindows,
              totalWindows: priced.totalWindows,
              qualifiedWindows: priced.qualifiedWindows,
              excludedWindows: priced.excludedWindows,
              qualifiedPeriodKeys: priced.qualifiedPeriodKeys,
              excludedPeriodKeys: priced.excludedPeriodKeys,
              recentQualifiedWindows: priced.recentQualifiedWindows,
              recentYesWindows: priced.recentYesWindows,
              recentYesProbabilityBps: priced.recentYesProbabilityBps,
              legEvidence: priced.legEvidence,
            }),
            yesProbabilityBps: priced.yesProbabilityBps,
            promptVersion: WEEKLY_PARLAY_PROMPT_VERSION,
            catalogVersion: WEEKLY_PARLAY_CATALOG_VERSION,
            schemaVersion: WEEKLY_PARLAY_SCHEMA_VERSION,
            evaluatorVersion: WEEKLY_PARLAY_EVALUATOR_VERSION,
            pricingVersion: WEEKLY_PARLAY_PRICING_VERSION,
            generationContext: JSON.stringify({
              candidateOrder: ordered.map((entry) => entry.playerId),
              selectedPlayerId: history.subject.playerId,
              championShortlist: history.championShortlist,
              generatedProposals: generated.proposals,
              recentEligibleGames: history.recentEligibleGames,
              fullyObservedWindows: history.fullyObservedWindows,
              timelineKind: timelineKind(period),
              scoringShape: weeklyParlayScoringShape(period),
            }),
            requestedModel: generated.model,
            resolvedModel: generated.resolvedModel,
            usage: JSON.stringify(generated.usage),
            durationMs: Date.now() - startedAt,
          },
          select: { id: true },
        });
        return await tx.bucksWeeklyParlayMarket.create({
          data: {
            definitionId: definition.id,
            serverId,
            periodKey: input.periodKey,
            slot,
            publishedAt: period.openAt,
            bettingClosesAt: period.bettingClosesAt,
            scoringEndsAt: period.scoringEndsAt,
          },
          select: { id: true },
        });
      });
      return { kind: "created", marketId: market.id };
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      const racedMarket =
        await prismaClient.bucksWeeklyParlayMarket.findUniqueOrThrow({
          where: {
            serverId_periodKey_slot: {
              serverId,
              periodKey: input.periodKey,
              slot,
            },
          },
          select: {
            id: true,
            definition: {
              select: {
                openAt: true,
                bettingClosesAt: true,
                scoringStartsAt: true,
                scoringEndsAt: true,
              },
            },
          },
        });
      assertMatchingTimeline(racedMarket, period);
      return { kind: "existing", marketId: racedMarket.id };
    }
  }
  return { kind: "no_price" };
}

export async function openWeeklyParlay(
  input: OpenWeeklyParlayInput,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<OpenWeeklyParlayResult> {
  const startedAt = Date.now();
  let result: OpenWeeklyParlayResult;
  try {
    result = await openWeeklyParlayInternal(input, prismaClient);
  } catch (error) {
    bettingWeeklyParlayGenerationTotal.inc({ result: "error" });
    throw error;
  }
  bettingWeeklyParlayGenerationTotal.inc({ result: result.kind });
  if (result.kind === "created") {
    bettingWeeklyParlayGenerationDurationSeconds.observe(
      (Date.now() - startedAt) / 1000,
    );
    logBucksTransition({
      event: "bucks.weekly_parlay.published",
      serverId: input.serverId,
      marketId: result.marketId,
      periodKey: input.periodKey,
      slot: input.slot ?? WEEKLY_PARLAY_SLOT,
      fromState: "none",
      toState: "publishing",
      surface: "cron",
    });
  }
  return result;
}
