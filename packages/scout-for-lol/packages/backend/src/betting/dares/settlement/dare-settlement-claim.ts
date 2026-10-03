import { pendingDareCalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state.ts";
import type { Db } from "#src/database/index.ts";

type DareTerminalResolution = "achieved" | "unachieved" | "voided";

export async function claimActiveDareSettlement(
  tx: Db,
  input: {
    dareId: number;
    value: boolean | null;
    proof: unknown;
    now: Date;
  },
): Promise<DareTerminalResolution> {
  const resolution =
    input.value === true
      ? "achieved"
      : input.value === false
        ? "unachieved"
        : "voided";
  const settled = await tx.bucksDare.updateMany({
    where: { id: input.dareId, dareState: "active" },
    data: {
      dareState: resolution,
      settledAt: input.now,
      finalValue: input.value,
      proofJson: input.proof === null ? null : JSON.stringify(input.proof),
      voidReason: input.value === null ? "missing_evidence" : null,
      ...pendingDareCalloutRefresh(),
    },
  });
  if (settled.count !== 1) {
    throw new Error(
      `Dare ${input.dareId.toString()} lost its settlement claim.`,
    );
  }
  return resolution;
}
