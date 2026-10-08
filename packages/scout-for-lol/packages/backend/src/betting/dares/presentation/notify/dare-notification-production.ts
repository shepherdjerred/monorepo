import type { DareContract, DarePotTotal } from "@scout-for-lol/data";
import type { DareFinality } from "#src/betting/dares/settlement/dare-settle-types.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import { deriveDareProgress } from "#src/betting/dares/presentation/dare-progress.ts";
import type { Db } from "#src/database/index.ts";

type TerminalResolution = "achieved" | "unachieved" | "voided";
type ProgressNotificationKind =
  | "advanced"
  | "new_best"
  | "race_leader_changed"
  | "rank_changed"
  | "regressed"
  | "sequence_changed"
  | "streak_changed";

function terminalKind(resolution: TerminalResolution) {
  if (resolution === "achieved") return "achieved" as const;
  return resolution === "voided" ? ("voided" as const) : ("failed" as const);
}

function terminalSummary(
  resolution: TerminalResolution,
  potTotal: DarePotTotal,
): string {
  if (resolution === "achieved") {
    return `Dare achieved; the ${potTotal.toString()} Bryan Bucks pot was paid out.`;
  }
  return resolution === "voided"
    ? `Dare voided because required evidence was incomplete; the ${potTotal.toString()} Bryan Bucks pot was refunded.`
    : "The Dare ended without being achieved.";
}

export async function enqueueTerminalDareNotification(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    potTotal: DarePotTotal;
    resolution: TerminalResolution;
    matchId?: string | undefined;
    now: Date;
  },
): Promise<void> {
  await enqueueDareNotificationInTransaction(tx, {
    dareId: input.dareId,
    revision: input.revision,
    category: "lifecycle",
    kind: terminalKind(input.resolution),
    ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
    summary: terminalSummary(input.resolution, input.potTotal),
    deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.revision.toString()}:terminal:${input.resolution}`,
    occurredAt: input.now,
  });
}

async function enqueueProgressNotification(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    kind: ProgressNotificationKind;
    matchId: string;
    summary: string;
    now: Date;
  },
): Promise<void> {
  await enqueueDareNotificationInTransaction(tx, {
    dareId: input.dareId,
    revision: input.revision,
    category: "progress",
    kind: input.kind,
    matchId: input.matchId,
    summary: input.summary,
    deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.revision.toString()}:progress:${input.matchId}`,
    occurredAt: input.now,
  });
}

function specializedProgressKind(
  contract: DareContract,
): ProgressNotificationKind | null {
  if (contract.activation.kind === "rank") return "rank_changed";
  if (
    contract.activation.kind === "improvement" &&
    contract.activation.goal.kind === "personal_best"
  ) {
    return "new_best";
  }
  if (contract.competition.kind === "race") return "race_leader_changed";
  const names = contract.resultStructure.gameSets
    .map((gameSet) => gameSet.name)
    .join(" ");
  if (names.includes("streak")) return "streak_changed";
  return names.includes("sequence") ? "sequence_changed" : null;
}

export async function enqueueMaterialDareProgressNotification(
  tx: Db,
  input: {
    dareId: number;
    contract: DareContract;
    evidence: readonly {
      matchId: string;
      gameEndAt: Date;
      evaluationOutput: string;
      sourceReferences: string;
      coverageState: string;
    }[];
    matchId: string;
    finality: DareFinality;
    now: Date;
  },
): Promise<void> {
  const progress = deriveDareProgress({
    compilation: {
      compilerVersion: input.contract.compilerVersion,
      canonicalSql: input.contract.canonicalSql,
      immutableAst: input.contract.immutableAst,
      queryHash: input.contract.queryHash,
      maxEligibleGames: input.contract.maxEligibleGames,
      facts: input.contract.facts,
      resultStructure: input.contract.resultStructure,
      finality: input.contract.finality,
      competition: input.contract.competition,
      activation: input.contract.activation,
    },
    evidence: input.evidence,
    targetKeys: input.contract.targets.map((target) => target.key),
    final: false,
    finalityReason: input.finality.reason,
  });
  if (
    progress.latestMaterialChange?.matchId !== input.matchId ||
    progress.latestMaterialChange.kind === "coverage"
  ) {
    return;
  }
  const kind =
    specializedProgressKind(input.contract) ??
    (progress.latestMaterialChange.kind === "regression"
      ? "regressed"
      : "advanced");
  await enqueueProgressNotification(tx, {
    dareId: input.dareId,
    revision: input.contract.revision,
    kind,
    matchId: input.matchId,
    summary: progress.summary,
    now: input.now,
  });
}
