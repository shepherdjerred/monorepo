import {
  BucksAccountQueryResultSchema,
  BucksBetQueryResultSchema,
  BucksLedgerQueryResultSchema,
  type BucksAccountQuery,
  type BucksAskResultRow,
  type BucksBetQuery,
  type BucksLedgerQuery,
} from "#src/betting/ask-analytics-schema.ts";
import type { DiscordAccountId } from "@scout-for-lol/data";
import type {
  BucksAskAnalyticsDataset,
  BucksAskBetFact,
  BucksAskLedgerFact,
} from "#src/betting/ask-analytics.ts";
import {
  ambiguousLatestBucksAliases,
  bucksAliasOwners,
  bucksLatestAliasOwners,
  disambiguatedBucksSubjectLabel,
  normalizeBucksAlias,
  uniqueBucksAliases,
} from "#src/betting/ask-analytics-alias.ts";
import {
  bucksAskDateRange,
  bucksAskIsoDay,
  parseBucksAskDateRange,
  withinBucksAskDateRange,
} from "#src/betting/ask-analytics-time.ts";

type FactGroup<Fact> = {
  values: string[];
  facts: Fact[];
};

type GroupDimension = {
  key: string;
  value: string;
};

export function bucksAskDatasetOverview(dataset: BucksAskAnalyticsDataset) {
  const dates = [
    ...dataset.accounts.map((fact) => fact.createdAt),
    ...dataset.ledger.map((fact) => fact.createdAt),
    ...dataset.bets.map((fact) => fact.eventAt),
  ];
  return {
    accountCount: dataset.accounts.length,
    ledgerEntryCount: dataset.ledger.length,
    positionCount: dataset.bets.length,
    marketCount: dataset.marketCount,
    settledPositionCount: dataset.bets.filter((fact) =>
      isFinancialPosition(fact),
    ).length,
    refundedPositionCount: dataset.bets.filter(
      (fact) => fact.outcome === "refunded",
    ).length,
    pendingPositionCount: dataset.bets.filter(
      (fact) => fact.outcome === "pending",
    ).length,
    ...bucksAskDateRange(dates),
    availableSubjectAliases: availableSubjectAliases(dataset),
    totalSubjectCount: dataset.aliasesByPuuid.size,
    notes: [
      "House accounts and positions are always excluded.",
      "Betting P&L includes outcome and parlay positions and uses gross payout minus stake for settled wins/losses; refunds are zero net and pending positions have no P&L.",
      "Player-subject attribution applies only to outcome positions; parlays are labeled as multi-player rather than attributed to one player.",
      "Ledger results cover guild-wide seed grants, non-betting earnings, and adjustments, and cannot be filtered or grouped by bettor, preventing reconstruction of private balances.",
      "The dataset-wide ledger count also includes betting movement rows that are deliberately unavailable through the ledger tool; use position analytics for betting finances.",
      "Bet date coverage uses settlement time when present and creation time otherwise.",
      "Canceled positions were deleted by the betting workflow and cannot be counted as positions.",
      "Balances, ledger deltas, and betting P&L are separate measures.",
    ],
  };
}

export function queryBucksAccounts(
  dataset: BucksAskAnalyticsDataset,
  rawInput: BucksAccountQuery,
  requesterDiscordId: DiscordAccountId,
) {
  const input = rawInput;
  const facts = dataset.accounts.filter(
    (fact) => fact.discordId === requesterDiscordId,
  );
  const { rows, totalGroups } = buildRows(
    groupFacts(facts, () => []),
    [],
    (group) =>
      input.measures.map((measure) => ({
        name: measure,
        value:
          measure === "balance_bb"
            ? sum(group.facts.map((fact) => fact.balance))
            : group.facts.length,
      })),
    { sort: undefined, limit: 1 },
  );
  return BucksAccountQueryResultSchema.parse({
    rows,
    coverage: {
      matchedRecords: facts.length,
      ...rowCoverage(rows, totalGroups),
      ...bucksAskDateRange(facts.length === 0 ? [] : [dataset.loadedAt]),
    },
  });
}

export function queryBucksLedger(
  dataset: BucksAskAnalyticsDataset,
  rawInput: BucksLedgerQuery,
) {
  const input = rawInput;
  validateSort(input.measures, input.sort?.measure);
  const range = parseBucksAskDateRange(input.filters.from, input.filters.to);
  const requestedKinds: ReadonlySet<BucksAskLedgerFact["kind"]> = new Set(
    input.filters.kinds,
  );
  const facts = dataset.ledger.filter(
    (fact) =>
      withinBucksAskDateRange(fact.createdAt, range) &&
      requestedKinds.has(fact.kind),
  );
  const groupBy = input.groupBy ?? [];
  const { rows, totalGroups } = buildRows(
    groupFacts(facts, (fact) =>
      groupBy.map((dimension) => ledgerDimension(fact, dimension)),
    ),
    groupBy,
    (group) =>
      input.measures.map((measure) => ({
        name: measure,
        value: ledgerMetric(group.facts, measure),
      })),
    { sort: input.sort, limit: input.limit },
  );
  return BucksLedgerQueryResultSchema.parse({
    rows,
    coverage: {
      matchedRecords: facts.length,
      ...rowCoverage(rows, totalGroups),
      ...bucksAskDateRange(facts.map((fact) => fact.createdAt)),
    },
  });
}

export function queryBucksBets(
  dataset: BucksAskAnalyticsDataset,
  rawInput: BucksBetQuery,
) {
  const input = rawInput;
  validateSort(input.measures, input.sort?.measure);
  const range = parseBucksAskDateRange(input.filters?.from, input.filters?.to);
  const requestedAliases =
    input.filters?.subjectAliases?.map((alias) => normalizeBucksAlias(alias)) ??
    [];
  const aliasOwners = bucksAliasOwners(dataset);
  const unknownSubjectAliases =
    input.filters?.subjectAliases?.filter(
      (alias) => !aliasOwners.has(normalizeBucksAlias(alias)),
    ) ?? [];
  const ambiguousRequestedSubjectAliases =
    input.filters?.subjectAliases?.filter(
      (alias) => (aliasOwners.get(normalizeBucksAlias(alias))?.size ?? 0) > 1,
    ) ?? [];
  const facts = dataset.bets.filter(
    (fact) =>
      ambiguousRequestedSubjectAliases.length === 0 &&
      withinBucksAskDateRange(fact.eventAt, range) &&
      matchesOptionalFilter(input.filters?.positionTypes, fact.positionType) &&
      matchesOptionalFilter(input.filters?.bettorDiscordIds, fact.discordId) &&
      (requestedAliases.length === 0 ||
        fact.subjectAliases.some((alias) =>
          requestedAliases.includes(normalizeBucksAlias(alias)),
        )) &&
      matchesOptionalFilter(
        input.filters?.subjectResults,
        fact.subjectResult,
      ) &&
      matchesOptionalFilter(input.filters?.betDirections, fact.direction) &&
      matchesOptionalFilter(input.filters?.outcomes, fact.outcome),
  );
  const groupBy = input.groupBy ?? [];
  const latestAliasOwners = bucksLatestAliasOwners(dataset);
  const ambiguousGroupedSubjectAliases = groupBy.includes("subject")
    ? ambiguousLatestBucksAliases(dataset, latestAliasOwners)
    : [];
  const ambiguousSubjectAliases = uniqueBucksAliases([
    ...ambiguousRequestedSubjectAliases,
    ...ambiguousGroupedSubjectAliases,
  ]).slice(0, 10);
  const { rows, totalGroups } = buildRows(
    groupFacts(facts, (fact) =>
      groupBy.map((dimension) =>
        betDimension(fact, dimension, latestAliasOwners),
      ),
    ),
    groupBy,
    (group) =>
      input.measures.map((measure) => ({
        name: measure,
        value: betMetric(group.facts, measure),
      })),
    { sort: input.sort, limit: input.limit },
  );
  const financial = facts.filter((fact) => isFinancialPosition(fact));
  return BucksBetQueryResultSchema.parse({
    rows,
    coverage: {
      matchedRecords: facts.length,
      ...rowCoverage(rows, totalGroups),
      financialPositions: financial.length,
      refundedPositions: facts.filter((fact) => fact.outcome === "refunded")
        .length,
      pendingPositions: facts.filter((fact) => fact.outcome === "pending")
        .length,
      ...bucksAskDateRange(facts.map((fact) => fact.eventAt)),
    },
    unknownSubjectAliases,
    ambiguousSubjectAliases,
    availableSubjectAliases: availableSubjectAliases(dataset),
  });
}

function groupFacts<Fact>(
  facts: readonly Fact[],
  dimensionsFor: (fact: Fact) => GroupDimension[],
): FactGroup<Fact>[] {
  const groups = new Map<string, FactGroup<Fact>>();
  for (const fact of facts) {
    const dimensions = dimensionsFor(fact);
    const key = JSON.stringify(dimensions.map((dimension) => dimension.key));
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        values: dimensions.map((dimension) => dimension.value),
        facts: [fact],
      });
    } else {
      existing.facts.push(fact);
    }
  }
  return [...groups.values()];
}

function buildRows<Fact>(
  groups: readonly FactGroup<Fact>[],
  dimensions: readonly string[],
  metricsFor: (group: FactGroup<Fact>) => BucksAskResultRow["metrics"],
  options: {
    sort: { measure: string; direction: "asc" | "desc" } | undefined;
    limit: number | undefined;
  },
): { rows: BucksAskResultRow[]; totalGroups: number } {
  const rows = groups.map((group) => ({
    dimensions: dimensions.map((name, index) => {
      const value = group.values[index];
      if (value === undefined) {
        throw new Error(`Missing grouped Bryan Bucks dimension ${name}`);
      }
      return { name, value };
    }),
    metrics: metricsFor(group),
  }));
  if (options.sort !== undefined) {
    const sort = options.sort;
    rows.sort((left, right) => {
      const leftValue = metricValue(left, sort.measure);
      const rightValue = metricValue(right, sort.measure);
      if (leftValue === null || rightValue === null) {
        if (leftValue === rightValue) return compareDimensions(left, right);
        return leftValue === null ? 1 : -1;
      }
      const difference = leftValue - rightValue;
      if (difference !== 0) {
        return sort.direction === "asc" ? difference : -difference;
      }
      return compareDimensions(left, right);
    });
  }
  return {
    rows: rows.slice(0, options.limit ?? 10),
    totalGroups: groups.length,
  };
}

function rowCoverage(
  rows: readonly BucksAskResultRow[],
  totalGroups: number,
): { returnedRows: number; totalGroups: number; truncated: boolean } {
  return {
    returnedRows: rows.length,
    totalGroups,
    truncated: rows.length < totalGroups,
  };
}

function ledgerDimension(
  fact: BucksAskLedgerFact,
  dimension: NonNullable<BucksLedgerQuery["groupBy"]>[number],
): GroupDimension {
  switch (dimension) {
    case "ledger_kind":
      return displayDimension(fact.kind);
    case "day":
      return displayDimension(bucksAskIsoDay(fact.createdAt));
  }
}

function betDimension(
  fact: BucksAskBetFact,
  dimension: NonNullable<BucksBetQuery["groupBy"]>[number],
  latestAliasOwners: ReadonlyMap<string, ReadonlySet<string>>,
): GroupDimension {
  switch (dimension) {
    case "position_type":
      return displayDimension(fact.positionType);
    case "bettor":
      return displayDimension(`<@${fact.discordId}>`);
    case "subject":
      return fact.subjectPuuid === null || fact.subjectAlias === null
        ? displayDimension("multi-player parlay")
        : {
            key: fact.subjectPuuid,
            value: disambiguatedBucksSubjectLabel(
              fact.subjectAlias,
              fact.subjectPuuid,
              latestAliasOwners,
            ),
          };
    case "subject_result":
      return displayDimension(fact.subjectResult);
    case "bet_direction":
      return displayDimension(fact.direction);
    case "outcome":
      return displayDimension(fact.outcome);
    case "day":
      return displayDimension(bucksAskIsoDay(fact.eventAt));
  }
}

function displayDimension(value: string): GroupDimension {
  return { key: value, value };
}

function ledgerMetric(
  facts: readonly BucksAskLedgerFact[],
  measure: BucksLedgerQuery["measures"][number],
): number {
  switch (measure) {
    case "delta_bb":
      return sum(facts.map((fact) => fact.delta));
    case "entry_count":
      return facts.length;
    case "bettor_count":
      return new Set(facts.map((fact) => fact.discordId)).size;
    case "match_count":
      return new Set(
        facts.flatMap((fact) => (fact.matchId === null ? [] : [fact.matchId])),
      ).size;
  }
}

function betMetric(
  facts: readonly BucksAskBetFact[],
  measure: BucksBetQuery["measures"][number],
): number | null {
  const financial = facts.filter((fact) => isFinancialPosition(fact));
  switch (measure) {
    case "net_bb":
      return financial.length === 0 &&
        facts.every((fact) => fact.outcome === "pending")
        ? null
        : sum(financial.map((fact) => financialNet(fact)));
    case "staked_bb":
      return sum(facts.map((fact) => fact.stake));
    case "gross_payout_bb":
      return financial.length === 0
        ? null
        : sum(financial.map((fact) => financialPayout(fact)));
    case "position_count":
      return facts.length;
    case "bettor_count":
      return new Set(facts.map((fact) => fact.discordId)).size;
    case "market_count":
      return new Set(facts.map((fact) => fact.marketKey)).size;
    case "settled_position_count":
      return financial.length;
    case "refunded_position_count":
      return facts.filter((fact) => fact.outcome === "refunded").length;
    case "pending_position_count":
      return facts.filter((fact) => fact.outcome === "pending").length;
    case "win_rate_percent":
      return financial.length === 0
        ? null
        : percent(
            financial.filter((fact) => fact.outcome === "won").length,
            financial.length,
          );
    case "roi_percent": {
      const staked = sum(financial.map((fact) => fact.stake));
      return staked === 0
        ? null
        : percent(sum(financial.map((fact) => financialNet(fact))), staked);
    }
  }
}

function isFinancialPosition(fact: BucksAskBetFact): boolean {
  return fact.outcome === "won" || fact.outcome === "lost";
}

function financialNet(fact: BucksAskBetFact): number {
  if (!isFinancialPosition(fact) || fact.netBb === null) {
    throw new Error("Expected a settled won/lost Bryan Bucks position");
  }
  return fact.netBb;
}

function financialPayout(fact: BucksAskBetFact): number {
  if (!isFinancialPosition(fact) || fact.grossPayout === null) {
    throw new Error("Expected a settled won/lost Bryan Bucks payout");
  }
  return fact.grossPayout;
}

function validateSort<Measure extends string>(
  measures: readonly Measure[],
  sortMeasure: Measure | undefined,
): void {
  if (sortMeasure !== undefined && !measures.includes(sortMeasure)) {
    throw new Error(
      "The sort measure must also be selected as an output measure",
    );
  }
}

function metricValue(row: BucksAskResultRow, measure: string): number | null {
  const metric = row.metrics.find((candidate) => candidate.name === measure);
  if (metric === undefined) {
    throw new Error(`Missing selected sort measure ${measure}`);
  }
  return metric.value;
}

function compareDimensions(
  left: BucksAskResultRow,
  right: BucksAskResultRow,
): number {
  return JSON.stringify(left.dimensions).localeCompare(
    JSON.stringify(right.dimensions),
  );
}

function availableSubjectAliases(dataset: BucksAskAnalyticsDataset): string[] {
  return [...dataset.aliasesByPuuid.values()]
    .map((history) => history.latestAlias)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 100);
}

function matchesOptionalFilter<Value>(
  values: readonly Value[] | undefined,
  candidate: Value,
): boolean {
  return (
    values === undefined || values.length === 0 || values.includes(candidate)
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function percent(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 10_000) / 100;
}
