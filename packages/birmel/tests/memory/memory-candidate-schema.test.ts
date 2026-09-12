import { describe, expect, test } from "vitest";
import { MemoryCandidateSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { StrictMemoryCandidateSchema } from "@shepherdjerred/birmel/memory/schemas.ts";

const ALICE = "400";
const BOB = "500";

function candidate(overrides: Record<string, unknown> = {}): unknown {
  return {
    scope: "relationship",
    subject: "Jerred and Alice",
    predicate: "relationship",
    value: "close friends",
    confidence: 0.8,
    salience: 0.7,
    origin: "inferred",
    validFrom: null,
    validUntil: null,
    relatedUserIds: [ALICE, BOB],
    sourceDiscordMessageIds: ["600"],
    ...overrides,
  };
}

function rejectionFor(input: unknown): string {
  const result = MemoryCandidateSchema.safeParse(input);
  if (result.success) {
    throw new Error("expected the candidate to be rejected");
  }
  const issue = result.error.issues[0];
  if (issue === undefined) {
    throw new Error("expected at least one issue");
  }
  expect(issue.path).toEqual(["relatedUserIds"]);
  return issue.message;
}

describe("memory candidate scope and related users", () => {
  test("accepts a relationship claim about two distinct people", () => {
    expect(MemoryCandidateSchema.safeParse(candidate()).success).toBe(true);
  });

  test("rejects a relationship claim with no related users", () => {
    expect(rejectionFor(candidate({ relatedUserIds: [] }))).toContain(
      "at least two distinct related user IDs",
    );
  });

  test("rejects a relationship claim with one related user", () => {
    expect(rejectionFor(candidate({ relatedUserIds: [ALICE] }))).toContain(
      "at least two distinct related user IDs",
    );
  });

  // Persistence deduplicates related IDs before counting them, so a repeated ID
  // is one user. Counting raw array length would let this through and it would
  // then throw inside buildIncomingStoredClaim.
  test("rejects a relationship claim that repeats the same related user", () => {
    expect(
      rejectionFor(candidate({ relatedUserIds: [ALICE, ALICE] })),
    ).toContain("at least two distinct related user IDs");
  });

  test("rejects a user claim naming two distinct related users", () => {
    expect(
      rejectionFor(candidate({ scope: "user", relatedUserIds: [ALICE, BOB] })),
    ).toContain("at most one related user ID");
  });

  test("accepts a user claim whose related user is repeated", () => {
    const result = MemoryCandidateSchema.safeParse(
      candidate({ scope: "user", relatedUserIds: [ALICE, ALICE] }),
    );

    expect(result.success).toBe(true);
  });

  test.each(["guild", "channel", "persona"])(
    "leaves %s scope free of related-user constraints",
    (scope) => {
      const result = MemoryCandidateSchema.safeParse(
        candidate({ scope, relatedUserIds: [] }),
      );

      expect(result.success).toBe(true);
    },
  );

  test("keeps the rule when the schema is narrowed for tool input", () => {
    expect(
      StrictMemoryCandidateSchema.safeParse(
        candidate({ relatedUserIds: [ALICE] }),
      ).success,
    ).toBe(false);
  });
});
