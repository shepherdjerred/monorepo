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

export const BUCKS_RECONCILIATION_PAGE_SIZE = 100;
export const BUCKS_RECONCILIATION_FINDING_LIMIT = 500;

export type BucksAuditSink = {
  push: (finding: BucksAuditFinding) => number;
};

/**
 * Count every discrepancy while retaining only a bounded diagnostic sample.
 * The append-only history can contain an arbitrary number of bad rows after a
 * systemic bug; reconciliation must still finish and report the exact scale.
 */
export class BucksAuditCollector implements BucksAuditSink {
  readonly #retained: BucksAuditFinding[] = [];
  readonly #kinds = new Set<BucksAuditFinding["kind"]>();
  #totalCount = 0;

  push(finding: BucksAuditFinding): number {
    this.#totalCount += 1;
    this.#kinds.add(finding.kind);
    if (this.#retained.length < BUCKS_RECONCILIATION_FINDING_LIMIT) {
      this.#retained.push(finding);
    }
    return this.#totalCount;
  }

  get totalCount(): number {
    return this.#totalCount;
  }

  get retained(): readonly BucksAuditFinding[] {
    return this.#retained;
  }

  get findingKinds(): readonly BucksAuditFinding["kind"][] {
    return [...this.#kinds];
  }
}

export function auditFinding(
  kind: BucksAuditFinding["kind"],
  message: string,
  ids: Pick<BucksAuditFinding, "bucksAccountId" | "poolId" | "betId"> = {},
): BucksAuditFinding {
  return { kind, message, ...ids };
}
