import { describe, expect, test } from "vitest";
import {
  AssignedPipelineOwnerSchema,
  MatchProcessingStateSchema,
  matchProcessingStateCodec,
  matchProcessingReceiptIdentityKey,
  MatchProcessingReceiptSchema,
  PipelineOwnerSchema,
  ReceiptKindSchema,
  ReceiptScopeSchema,
  receiptScopeKey,
} from "#src/match-processing/states.ts";

const GUILD_ID = "123456789012345678";
const OTHER_GUILD_ID = "876543210987654321";

const validStateInput = {
  matchId: "NA1_1234567890",
  owner: { kind: "unowned" },
  policy: "ARCHIVE_ONLY",
  promotion: null,
  receipts: [],
};

describe("MatchProcessingStateSchema", () => {
  test("parses a minimal unowned archive-only state", () => {
    const parsed = MatchProcessingStateSchema.parse(validStateInput);
    expect(parsed.owner.kind).toBe("unowned");
    expect(parsed.policy).toBe("ARCHIVE_ONLY");
    expect(parsed.promotion).toBeNull();
    expect(parsed.receipts).toEqual([]);
  });

  test("parses a full state with a promotion record and receipts", () => {
    const parsed = MatchProcessingStateSchema.parse({
      matchId: "EUW1_9876543210",
      owner: { kind: "temporal-v2" },
      policy: "FULL",
      promotion: { promotedAt: "2025-10-16T12:00:00Z" },
      receipts: [
        {
          kind: "report-delivered",
          version: 1,
          scope: { kind: "global" },
          recordedAt: "2025-10-16T12:01:00Z",
        },
        {
          kind: "report-delivered",
          version: 1,
          scope: { kind: "guild", guildId: GUILD_ID },
          recordedAt: "2025-10-16T12:02:00Z",
        },
        {
          kind: "settlement-recorded",
          version: 2,
          scope: { kind: "account", accountId: 42 },
          recordedAt: "2025-10-16T12:03:00Z",
        },
      ],
    });
    expect(parsed.receipts).toHaveLength(3);
  });

  test("accepts receipts spanning multiple kinds and versions for one scope", () => {
    const parsed = MatchProcessingStateSchema.parse({
      ...validStateInput,
      receipts: [
        {
          kind: "report-delivered",
          version: 1,
          scope: { kind: "global" },
          recordedAt: "2025-10-16T12:01:00Z",
        },
        {
          kind: "settlement-recorded",
          version: 1,
          scope: { kind: "global" },
          recordedAt: "2025-10-16T12:02:00Z",
        },
        {
          kind: "report-delivered",
          version: 2,
          scope: { kind: "global" },
          recordedAt: "2025-10-16T12:03:00Z",
        },
      ],
    });
    expect(parsed.receipts).toHaveLength(3);
  });

  test("parses a born-full state with no promotion record", () => {
    const parsed = MatchProcessingStateSchema.parse({
      ...validStateInput,
      policy: "FULL",
    });
    expect(parsed.policy).toBe("FULL");
    expect(parsed.promotion).toBeNull();
  });

  test("rejects an ARCHIVE_ONLY state carrying a promotion record", () => {
    expect(() =>
      MatchProcessingStateSchema.parse({
        ...validStateInput,
        promotion: { promotedAt: "2025-10-16T12:00:00Z" },
      }),
    ).toThrow(/ARCHIVE_ONLY state cannot carry a promotion record/);
  });

  test.each([
    {
      scope: { kind: "global" },
      description: "global",
    },
    {
      scope: { kind: "guild", guildId: GUILD_ID },
      description: "guild",
    },
    {
      scope: { kind: "account", accountId: 42 },
      description: "account",
    },
  ])(
    "rejects duplicate (kind, version, $description scope) identities even with different evidence",
    ({ scope }) => {
      expect(() =>
        MatchProcessingStateSchema.parse({
          ...validStateInput,
          receipts: [
            {
              kind: "report-delivered",
              version: 1,
              scope,
              recordedAt: "2025-10-16T12:01:00Z",
            },
            {
              kind: "report-delivered",
              version: 1,
              scope,
              recordedAt: "2025-10-16T12:02:00Z",
            },
          ],
        }),
      ).toThrow(/duplicate receipt identity/);
    },
  );

  test("accepts distinct scopes for the same kind and version", () => {
    const parsed = MatchProcessingStateSchema.parse({
      ...validStateInput,
      receipts: [
        {
          kind: "report-delivered",
          version: 1,
          scope: { kind: "guild", guildId: GUILD_ID },
          recordedAt: "2025-10-16T12:01:00Z",
        },
        {
          kind: "report-delivered",
          version: 1,
          scope: { kind: "guild", guildId: OTHER_GUILD_ID },
          recordedAt: "2025-10-16T12:02:00Z",
        },
      ],
    });
    expect(parsed.receipts).toHaveLength(2);
  });

  test.each([
    { receiptKind: "", reason: "empty" },
    { receiptKind: "Report-Delivered", reason: "uppercase" },
    { receiptKind: "report:delivered", reason: "colon" },
    { receiptKind: "-leading", reason: "leading hyphen" },
  ])("rejects a receipt kind that is $reason", ({ receiptKind }) => {
    expect(() => ReceiptKindSchema.parse(receiptKind)).toThrow();
  });

  test.each([
    { version: 0, reason: "zero" },
    { version: -1, reason: "negative" },
    { version: 1.5, reason: "non-integer" },
  ])("rejects a receipt version that is $reason", ({ version }) => {
    expect(() =>
      MatchProcessingReceiptSchema.parse({
        kind: "report-delivered",
        version,
        scope: { kind: "global" },
        recordedAt: "2025-10-16T12:01:00Z",
      }),
    ).toThrow();
  });

  test("rejects an unknown owner kind", () => {
    expect(() =>
      MatchProcessingStateSchema.parse({
        ...validStateInput,
        owner: { kind: "manual" },
      }),
    ).toThrow();
  });

  test("rejects an unknown policy", () => {
    expect(() =>
      MatchProcessingStateSchema.parse({
        ...validStateInput,
        policy: "PARTIAL",
      }),
    ).toThrow();
  });

  test("rejects a malformed match id", () => {
    expect(() =>
      MatchProcessingStateSchema.parse({
        ...validStateInput,
        matchId: "not-a-match-id",
      }),
    ).toThrow();
  });

  test("rejects extra keys", () => {
    expect(() =>
      MatchProcessingStateSchema.parse({
        ...validStateInput,
        note: "extra",
      }),
    ).toThrow();
  });
});

describe("AssignedPipelineOwnerSchema", () => {
  test.each([{ kind: "legacy-v1" }, { kind: "temporal-v2" }])(
    "accepts the $kind owner",
    (owner) => {
      expect(AssignedPipelineOwnerSchema.parse(owner)).toEqual(owner);
    },
  );

  test("rejects the unowned owner, which cannot claim", () => {
    expect(() =>
      AssignedPipelineOwnerSchema.parse({ kind: "unowned" }),
    ).toThrow();
    expect(PipelineOwnerSchema.parse({ kind: "unowned" })).toEqual({
      kind: "unowned",
    });
  });
});

describe("receiptScopeKey", () => {
  test("assigns distinct keys to every scope kind", () => {
    const globalScope = ReceiptScopeSchema.parse({ kind: "global" });
    const guildScope = ReceiptScopeSchema.parse({
      kind: "guild",
      guildId: GUILD_ID,
    });
    const accountScope = ReceiptScopeSchema.parse({
      kind: "account",
      accountId: 42,
    });
    const keys = [
      receiptScopeKey(globalScope),
      receiptScopeKey(guildScope),
      receiptScopeKey(accountScope),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  test("keeps guild and account scopes with similar ids distinct", () => {
    const guildScope = ReceiptScopeSchema.parse({
      kind: "guild",
      guildId: GUILD_ID,
    });
    const accountScope = ReceiptScopeSchema.parse({
      kind: "account",
      accountId: 42,
    });
    expect(receiptScopeKey(guildScope)).not.toBe(receiptScopeKey(accountScope));
  });
});

describe("matchProcessingReceiptIdentityKey", () => {
  const baseReceipt = MatchProcessingReceiptSchema.parse({
    kind: "report-delivered",
    version: 1,
    scope: { kind: "global" },
    recordedAt: "2025-10-16T12:01:00Z",
  });

  test("differs when any identity component differs", () => {
    const baseKey = matchProcessingReceiptIdentityKey(baseReceipt);
    const variants = [
      { ...baseReceipt, kind: ReceiptKindSchema.parse("settlement-recorded") },
      { ...baseReceipt, version: 2 },
      {
        ...baseReceipt,
        scope: ReceiptScopeSchema.parse({ kind: "guild", guildId: GUILD_ID }),
      },
    ];
    for (const variant of variants) {
      expect(matchProcessingReceiptIdentityKey(variant)).not.toBe(baseKey);
    }
  });

  test("ignores evidence: same identity with different recordedAt shares a key", () => {
    const later = MatchProcessingReceiptSchema.parse({
      kind: "report-delivered",
      version: 1,
      scope: { kind: "global" },
      recordedAt: "2025-10-16T18:00:00Z",
    });
    expect(matchProcessingReceiptIdentityKey(later)).toBe(
      matchProcessingReceiptIdentityKey(baseReceipt),
    );
  });
});

describe("matchProcessingStateCodec", () => {
  test("round-trips a state through the versioned envelope", () => {
    const state = MatchProcessingStateSchema.parse({
      matchId: "EUW1_9876543210",
      owner: { kind: "legacy-v1" },
      policy: "FULL",
      promotion: { promotedAt: "2025-10-16T12:00:00Z" },
      receipts: [
        {
          kind: "report-delivered",
          version: 1,
          scope: { kind: "global" },
          recordedAt: "2025-10-16T12:01:00Z",
        },
      ],
    });
    const envelope = matchProcessingStateCodec.serialize(state);
    expect(envelope.kind).toBe("match-processing-state");
    expect(envelope.version).toBe(1);
    expect(matchProcessingStateCodec.parse(envelope)).toEqual(state);
  });

  test("rejects an unknown envelope version", () => {
    const state = MatchProcessingStateSchema.parse(validStateInput);
    const envelope = matchProcessingStateCodec.serialize(state);
    expect(() =>
      matchProcessingStateCodec.parse({ ...envelope, version: 2 }),
    ).toThrow(/unknown match-processing-state envelope version 2/);
  });

  test("rejects an unknown envelope kind", () => {
    const state = MatchProcessingStateSchema.parse(validStateInput);
    const envelope = matchProcessingStateCodec.serialize(state);
    expect(() =>
      matchProcessingStateCodec.parse({ ...envelope, kind: "match-state" }),
    ).toThrow();
  });

  test("rejects envelope data violating a state invariant", () => {
    expect(() =>
      matchProcessingStateCodec.parse({
        kind: "match-processing-state",
        version: 1,
        data: {
          ...validStateInput,
          promotion: { promotedAt: "2025-10-16T12:00:00Z" },
        },
      }),
    ).toThrow(/ARCHIVE_ONLY state cannot carry a promotion record/);
  });
});
