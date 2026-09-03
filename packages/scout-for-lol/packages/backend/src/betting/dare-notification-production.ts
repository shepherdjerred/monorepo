import type { DareContractV2 } from "@scout-for-lol/data";
import type { DareMatchEvidenceV2 } from "#src/betting/dare-evidence-v2.ts";
import type { DareFinalityV2 } from "#src/betting/dare-proof-v2.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dare-notification-outbox.ts";
import { deriveDareProgressV2 } from "#src/betting/dare-progress-v2.ts";
import type { Db } from "#src/database/index.ts";

type TerminalResolution = "achieved" | "unachieved" | "voided";

function terminalKind(resolution: TerminalResolution) {
  if (resolution === "achieved") return "achieved" as const;
  if (resolution === "voided") return "voided" as const;
  return "failed" as const;
}

function terminalSummary(
  resolution: TerminalResolution,
  potTotal: number,
): string {
  if (resolution === "achieved") {
    return `Dare achieved; the ${potTotal.toString()} Bryan Bucks pot was paid out.`;
  }
  if (resolution === "voided") {
    return `Dare voided because required evidence was incomplete; the ${potTotal.toString()} Bryan Bucks pot was refunded.`;
  }
  return "The Dare ended without being achieved.";
}

export async function enqueueTerminalDareNotification(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    potTotal: number;
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

export async function enqueueMaterialDareProgressNotification(
  tx: Db,
  input: {
    dareId: number;
    contract: DareContractV2;
    evidence: readonly DareMatchEvidenceV2[];
    matchId: string;
    finality: DareFinalityV2;
    now: Date;
  },
): Promise<void> {
  const progress = deriveDareProgressV2({
    plan: input.contract.compiledPlan,
    evidence: input.evidence,
    targetKeys: input.contract.targets.map((target) => target.key),
    final: false,
    finalityReason: input.finality.reason,
  });
  if (
    progress.latestMaterialChange?.matchId !== input.matchId ||
    !["advance", "regression"].includes(progress.latestMaterialChange.kind)
  ) {
    return;
  }
  const kind =
    progress.latestMaterialChange.kind === "regression"
      ? "regressed"
      : "advanced";
  await enqueueDareNotificationInTransaction(tx, {
    dareId: input.dareId,
    revision: input.contract.revision,
    category: "progress",
    kind,
    matchId: input.matchId,
    summary: progress.summary,
    deduplicationKey: `dare:${input.dareId.toString()}:revision:${input.contract.revision.toString()}:progress:${input.matchId}`,
    occurredAt: input.now,
  });
}
