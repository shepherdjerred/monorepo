import { z } from "zod";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  MatchProcessingReceiptSchema,
  receiptScopeKey,
  type ReceiptScope,
} from "@scout-for-lol/domain/match-processing/states.ts";

/**
 * Row codec for MatchProcessingReceipt.
 *
 * The stored identity widens the domain receipt with `kind` and `version`
 * (which pipeline step wrote it, under which semantics revision); within one
 * (matchId, kind, version) the domain invariant holds — one receipt per scope
 * identity, keyed by receiptScopeKey. The scopeKey column is that canonical
 * key; the migration CHECK keeps it consistent with the split scope columns,
 * and this codec recomputes it on write so the two can never disagree.
 */

export type MatchProcessingReceiptRecord = z.infer<
  typeof MatchProcessingReceiptRecordSchema
>;
export const MatchProcessingReceiptRecordSchema = z.strictObject({
  matchId: RiotMatchIdSchema,
  kind: z.string().min(1),
  version: z.int().min(1),
  receipt: MatchProcessingReceiptSchema,
  /** Raw JSON evidence, opaque here; the owning feature parses it. */
  evidence: z.string().nullable(),
});

/** Column shape of a MatchProcessingReceipt row, minus DB-managed columns. */
export type MatchProcessingReceiptRow = {
  riotMatchId: string;
  kind: string;
  version: number;
  scopeKind: string;
  scopeGuildId: string | null;
  scopeAccountId: number | null;
  scopeKey: string;
  evidence: string | null;
  recordedAt: Date;
};

const RawReceiptRowSchema = z.object({
  riotMatchId: z.string(),
  kind: z.string(),
  version: z.number().int(),
  scopeKind: z.string(),
  scopeGuildId: z.string().nullable(),
  scopeAccountId: z.number().int().nullable(),
  scopeKey: z.string(),
  evidence: z.string().nullable(),
  recordedAt: z.date(),
});

function scopeCandidate(raw: {
  scopeKind: string;
  scopeGuildId: string | null;
  scopeAccountId: number | null;
}): Record<string, unknown> {
  switch (raw.scopeKind) {
    case "global":
      return { kind: "global" };
    case "guild":
      return { kind: "guild", guildId: raw.scopeGuildId };
    case "account":
      return { kind: "account", accountId: raw.scopeAccountId };
    default:
      throw new Error(
        `Unknown receipt scopeKind column value: ${raw.scopeKind}`,
      );
  }
}

export function matchProcessingReceiptRowToRecord(
  row: unknown,
): MatchProcessingReceiptRecord {
  const raw = RawReceiptRowSchema.parse(row);
  const record = MatchProcessingReceiptRecordSchema.parse({
    matchId: raw.riotMatchId,
    kind: raw.kind,
    version: raw.version,
    receipt: {
      scope: scopeCandidate(raw),
      recordedAt: raw.recordedAt.toISOString(),
    },
    evidence: raw.evidence,
  });
  const expectedScopeKey = receiptScopeKey(record.receipt.scope);
  if (raw.scopeKey !== expectedScopeKey) {
    throw new Error(
      `Receipt scopeKey column ${raw.scopeKey} does not match its scope columns (${expectedScopeKey})`,
    );
  }
  return record;
}

function scopeColumns(scope: ReceiptScope): {
  scopeKind: string;
  scopeGuildId: string | null;
  scopeAccountId: number | null;
} {
  switch (scope.kind) {
    case "global":
      return { scopeKind: "global", scopeGuildId: null, scopeAccountId: null };
    case "guild":
      return {
        scopeKind: "guild",
        scopeGuildId: scope.guildId,
        scopeAccountId: null,
      };
    case "account":
      return {
        scopeKind: "account",
        scopeGuildId: null,
        scopeAccountId: scope.accountId,
      };
  }
}

export function matchProcessingReceiptRecordToRow(
  record: MatchProcessingReceiptRecord,
): MatchProcessingReceiptRow {
  return {
    riotMatchId: record.matchId,
    kind: record.kind,
    version: record.version,
    ...scopeColumns(record.receipt.scope),
    scopeKey: receiptScopeKey(record.receipt.scope),
    evidence: record.evidence,
    recordedAt: new Date(record.receipt.recordedAt),
  };
}
