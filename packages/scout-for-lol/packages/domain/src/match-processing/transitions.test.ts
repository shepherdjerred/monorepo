import { describe, expect, test } from "vitest";
import { IsoInstantSchema } from "#src/identity/brands.ts";
import {
  AssignedPipelineOwnerSchema,
  MatchProcessingReceiptSchema,
  MatchProcessingStateSchema,
  type MatchProcessingState,
} from "#src/match-processing/states.ts";
import {
  claimOwnership,
  promoteArchiveOnlyToFull,
  recordReceipt,
} from "#src/match-processing/transitions.ts";

const GUILD_ID = "123456789012345678";
const OTHER_GUILD_ID = "876543210987654321";
const PROMOTED_AT = IsoInstantSchema.parse("2025-10-16T12:00:00Z");

const legacyOwner = AssignedPipelineOwnerSchema.parse({ kind: "legacy-v1" });
const temporalOwner = AssignedPipelineOwnerSchema.parse({
  kind: "temporal-v2",
});

function makeState(overrides?: Record<string, unknown>): MatchProcessingState {
  return MatchProcessingStateSchema.parse({
    matchId: "NA1_1234567890",
    owner: { kind: "unowned" },
    policy: "ARCHIVE_ONLY",
    promotion: null,
    receipts: [],
    ...overrides,
  });
}

function makeReceipt(scope: Record<string, unknown>) {
  return MatchProcessingReceiptSchema.parse({
    scope,
    recordedAt: "2025-10-16T12:01:00Z",
  });
}

describe("claimOwnership", () => {
  test.each([
    { claimant: legacyOwner, kind: "legacy-v1" },
    { claimant: temporalOwner, kind: "temporal-v2" },
  ])("applies a $kind claim on an unowned match", ({ claimant, kind }) => {
    const state = makeState();
    const result = claimOwnership({ state, claimant });
    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.next.owner.kind).toBe(kind);
      expect(result.next.policy).toBe(state.policy);
      expect(result.next.receipts).toEqual(state.receipts);
    }
  });

  test("does not mutate the input state when applying a claim", () => {
    const state = makeState();
    claimOwnership({ state, claimant: legacyOwner });
    expect(state.owner.kind).toBe("unowned");
  });

  test.each([
    { holder: { kind: "legacy-v1" }, claimant: legacyOwner },
    { holder: { kind: "temporal-v2" }, claimant: temporalOwner },
  ])(
    "treats a repeat claim by the holder $holder.kind as already applied",
    ({ holder, claimant }) => {
      const state = makeState({ owner: holder });
      expect(claimOwnership({ state, claimant })).toEqual({
        outcome: "already-applied",
      });
    },
  );

  test.each([
    { holder: { kind: "legacy-v1" }, claimant: temporalOwner },
    { holder: { kind: "temporal-v2" }, claimant: legacyOwner },
  ])(
    "refuses to transfer ownership from $holder.kind to $claimant.kind",
    ({ holder, claimant }) => {
      const state = makeState({ owner: holder });
      expect(claimOwnership({ state, claimant })).toEqual({
        outcome: "conflict",
        reason: "ownership-held-by-another-owner",
      });
    },
  );
});

describe("promoteArchiveOnlyToFull", () => {
  test("promotes an archive-only match and records the promotion", () => {
    const state = makeState();
    const result = promoteArchiveOnlyToFull({ state, promotedAt: PROMOTED_AT });
    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.next.policy).toBe("FULL");
      expect(result.next.promotion).toEqual({ promotedAt: PROMOTED_AT });
    }
  });

  test("does not mutate the input state when promoting", () => {
    const state = makeState();
    promoteArchiveOnlyToFull({ state, promotedAt: PROMOTED_AT });
    expect(state.policy).toBe("ARCHIVE_ONLY");
    expect(state.promotion).toBeNull();
  });

  test("treats a retry on a promoted match as already applied", () => {
    const state = makeState({
      policy: "FULL",
      promotion: { promotedAt: "2025-10-16T12:00:00Z" },
    });
    expect(
      promoteArchiveOnlyToFull({ state, promotedAt: PROMOTED_AT }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("refuses to promote a match that was born FULL", () => {
    const state = makeState({ policy: "FULL" });
    expect(
      promoteArchiveOnlyToFull({ state, promotedAt: PROMOTED_AT }),
    ).toEqual({ outcome: "conflict", reason: "promotion-target-born-full" });
  });

  test("never downgrades: every transition preserves FULL", () => {
    const promoted = promoteArchiveOnlyToFull({
      state: makeState(),
      promotedAt: PROMOTED_AT,
    });
    expect(promoted.outcome).toBe("applied");
    if (promoted.outcome !== "applied") {
      return;
    }
    const full = promoted.next;

    const claimed = claimOwnership({ state: full, claimant: legacyOwner });
    expect(claimed.outcome).toBe("applied");
    if (claimed.outcome === "applied") {
      expect(claimed.next.policy).toBe("FULL");
    }

    const receipted = recordReceipt({
      state: full,
      receipt: makeReceipt({ kind: "global" }),
    });
    expect(receipted.outcome).toBe("applied");
    if (receipted.outcome === "applied") {
      expect(receipted.next.policy).toBe("FULL");
      expect(receipted.next.promotion).toEqual({ promotedAt: PROMOTED_AT });
    }

    expect(
      promoteArchiveOnlyToFull({ state: full, promotedAt: PROMOTED_AT }),
    ).toEqual({ outcome: "already-applied" });
  });
});

describe("recordReceipt", () => {
  test.each([
    { scope: { kind: "global" }, description: "global" },
    { scope: { kind: "guild", guildId: GUILD_ID }, description: "guild" },
    { scope: { kind: "account", accountId: 42 }, description: "account" },
  ])("applies a new $description receipt", ({ scope }) => {
    const state = makeState();
    const receipt = makeReceipt(scope);
    const result = recordReceipt({ state, receipt });
    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.next.receipts).toEqual([receipt]);
    }
  });

  test("does not mutate the input state when recording", () => {
    const state = makeState();
    recordReceipt({ state, receipt: makeReceipt({ kind: "global" }) });
    expect(state.receipts).toEqual([]);
  });

  test.each([
    { scope: { kind: "global" }, description: "global" },
    { scope: { kind: "guild", guildId: GUILD_ID }, description: "guild" },
    { scope: { kind: "account", accountId: 42 }, description: "account" },
  ])(
    "treats a repeat $description receipt as already applied even with a different timestamp",
    ({ scope }) => {
      const state = makeState({
        receipts: [{ scope, recordedAt: "2025-10-16T12:01:00Z" }],
      });
      const retry = MatchProcessingReceiptSchema.parse({
        scope,
        recordedAt: "2025-10-16T18:00:00Z",
      });
      expect(recordReceipt({ state, receipt: retry })).toEqual({
        outcome: "already-applied",
      });
    },
  );

  test("applies receipts for distinct scopes of the same kind", () => {
    const state = makeState({
      receipts: [
        {
          scope: { kind: "guild", guildId: GUILD_ID },
          recordedAt: "2025-10-16T12:01:00Z",
        },
      ],
    });
    const result = recordReceipt({
      state,
      receipt: makeReceipt({ kind: "guild", guildId: OTHER_GUILD_ID }),
    });
    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.next.receipts).toHaveLength(2);
    }
  });

  test("applies receipts across different scope kinds independently", () => {
    let state = makeState();
    for (const scope of [
      { kind: "global" },
      { kind: "guild", guildId: GUILD_ID },
      { kind: "account", accountId: 42 },
    ]) {
      const result = recordReceipt({ state, receipt: makeReceipt(scope) });
      expect(result.outcome).toBe("applied");
      if (result.outcome === "applied") {
        state = result.next;
      }
    }
    expect(state.receipts).toHaveLength(3);
  });

  test("recorded states still satisfy the state schema", () => {
    const state = makeState();
    const result = recordReceipt({
      state,
      receipt: makeReceipt({ kind: "global" }),
    });
    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(() => MatchProcessingStateSchema.parse(result.next)).not.toThrow();
    }
  });
});
