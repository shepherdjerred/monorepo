import { pendingDareV2CalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state-v2.ts";
import type { Db } from "#src/database/index.ts";

type DareTerminalResolution = "achieved" | "unachieved" | "voided";

export async function claimActiveDareV2Settlement(
  tx: Db,
  input: {
    dareId: number;
    value: boolean | null;
    proof: unknown;
    now: Date;
    contractVersion: "v2" | "v3";
    refreshCallout: boolean;
  },
): Promise<DareTerminalResolution> {
  const resolution =
    input.value === true
      ? "achieved"
      : input.value === false
        ? "unachieved"
        : "voided";
  const settled = await tx.bucksDareV2.updateMany({
    where: { id: input.dareId, dareState: "active" },
    data: {
      dareState: resolution,
      settledAt: input.now,
      finalValue: input.value,
      proofJson: input.proof === null ? null : JSON.stringify(input.proof),
      voidReason: input.value === null ? "missing_evidence" : null,
      ...(input.refreshCallout ? pendingDareV2CalloutRefresh() : {}),
    },
  });
  if (settled.count !== 1) {
    throw new Error(
      `Dare ${input.contractVersion} ${input.dareId.toString()} lost its settlement claim.`,
    );
  }
  return resolution;
}
