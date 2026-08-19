export type BucksAuditFinding = {
  kind:
    | "balance_sum"
    | "running_balance"
    | "active_position"
    | "reserved_stake"
    | "allocation"
    | "matching_summary"
    | "house_exposure"
    | "refund"
    | "fee"
    | "payout_conservation"
    | "settlement";
  message: string;
  bucksAccountId?: number;
  poolId?: number;
  betId?: number;
};

export function auditFinding(
  kind: BucksAuditFinding["kind"],
  message: string,
  ids: Pick<BucksAuditFinding, "bucksAccountId" | "poolId" | "betId"> = {},
): BucksAuditFinding {
  return { kind, message, ...ids };
}
