import { z } from "zod";
import { MatchIdSchema, type MatchId } from "@scout-for-lol/data";

/**
 * Discord custom IDs for post-match MVP vote controls.
 *
 * Format:
 * - button: `vote:1:<a|e>:<matchId>`
 * - select: `vote:1:s:<a|e>:<matchId>`
 * - modal:  `vote:1:m:<a|e>:<matchId>:<nomineeIndex>`
 *
 * The ID is a key, never mutable vote state. The modal carries the nominee
 * index chosen on the select so two overlapping reason forms cannot attach a
 * justification to the wrong player. Category is relative to the voter and is
 * re-checked against the frozen roster. A malformed ID is never fatal.
 */

export const VOTE_COMPONENT_NAMESPACE = "vote";
export const VOTE_COMPONENT_VERSION = "1";
export const MAX_CUSTOM_ID_LENGTH = 100;

export type MatchMvpCategory = z.infer<typeof MatchMvpCategorySchema>;
export const MatchMvpCategorySchema = z.enum(["ally", "enemy"]);

const CategoryWireSchema = z.enum(["a", "e"]);

export type VoteButtonCustomId = z.infer<typeof VoteButtonCustomIdSchema>;
export const VoteButtonCustomIdSchema = z.strictObject({
  kind: z.literal("button"),
  category: MatchMvpCategorySchema,
  matchId: MatchIdSchema,
});

export type VoteSelectCustomId = z.infer<typeof VoteSelectCustomIdSchema>;
export const VoteSelectCustomIdSchema = z.strictObject({
  kind: z.literal("select"),
  category: MatchMvpCategorySchema,
  matchId: MatchIdSchema,
});

export type VoteModalCustomId = z.infer<typeof VoteModalCustomIdSchema>;
export const VoteModalCustomIdSchema = z.strictObject({
  kind: z.literal("modal"),
  category: MatchMvpCategorySchema,
  matchId: MatchIdSchema,
  nomineeIndex: z.number().int().min(0).max(9),
});

export type VoteCustomId = z.infer<typeof VoteCustomIdSchema>;
export const VoteCustomIdSchema = z.discriminatedUnion("kind", [
  VoteButtonCustomIdSchema,
  VoteSelectCustomIdSchema,
  VoteModalCustomIdSchema,
]);

function categoryToWire(category: MatchMvpCategory): "a" | "e" {
  return category === "ally" ? "a" : "e";
}

function categoryFromWire(wire: string): MatchMvpCategory | undefined {
  const parsed = CategoryWireSchema.safeParse(wire);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data === "a" ? "ally" : "enemy";
}

function assertCustomIdLength(id: string): string {
  if (id.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error(
      `MVP vote custom ID is ${id.length.toString()} characters, over Discord's ${MAX_CUSTOM_ID_LENGTH.toString()} limit: ${id}`,
    );
  }
  return id;
}

export function formatVoteButtonCustomId(input: {
  category: MatchMvpCategory;
  matchId: MatchId;
}): string {
  const parsed = VoteButtonCustomIdSchema.parse({
    kind: "button",
    category: input.category,
    matchId: input.matchId,
  });
  return assertCustomIdLength(
    [
      VOTE_COMPONENT_NAMESPACE,
      VOTE_COMPONENT_VERSION,
      categoryToWire(parsed.category),
      parsed.matchId,
    ].join(":"),
  );
}

export function formatVoteSelectCustomId(input: {
  category: MatchMvpCategory;
  matchId: MatchId;
}): string {
  const parsed = VoteSelectCustomIdSchema.parse({
    kind: "select",
    category: input.category,
    matchId: input.matchId,
  });
  return assertCustomIdLength(
    [
      VOTE_COMPONENT_NAMESPACE,
      VOTE_COMPONENT_VERSION,
      "s",
      categoryToWire(parsed.category),
      parsed.matchId,
    ].join(":"),
  );
}

export function formatVoteModalCustomId(input: {
  category: MatchMvpCategory;
  matchId: MatchId;
  nomineeIndex: number;
}): string {
  const parsed = VoteModalCustomIdSchema.parse({
    kind: "modal",
    category: input.category,
    matchId: input.matchId,
    nomineeIndex: input.nomineeIndex,
  });
  return assertCustomIdLength(
    [
      VOTE_COMPONENT_NAMESPACE,
      VOTE_COMPONENT_VERSION,
      "m",
      categoryToWire(parsed.category),
      parsed.matchId,
      String(parsed.nomineeIndex),
    ].join(":"),
  );
}

export function isVoteCustomId(raw: string): boolean {
  return raw.startsWith(`${VOTE_COMPONENT_NAMESPACE}:`);
}

export function parseVoteCustomId(raw: string): VoteCustomId | undefined {
  const segments = raw.split(":");
  if (segments[0] !== VOTE_COMPONENT_NAMESPACE) {
    return undefined;
  }
  if (segments[1] !== VOTE_COMPONENT_VERSION) {
    return undefined;
  }
  if (segments.length === 4) {
    const category = categoryFromWire(segments[2] ?? "");
    const matchId = MatchIdSchema.safeParse(segments[3]);
    return category === undefined || !matchId.success
      ? undefined
      : { kind: "button", category, matchId: matchId.data };
  }
  if (segments.length === 5) {
    const kindWire = segments[2];
    const category = categoryFromWire(segments[3] ?? "");
    const matchId = MatchIdSchema.safeParse(segments[4]);
    if (category === undefined || !matchId.success) {
      return undefined;
    }
    if (kindWire === "s") {
      return { kind: "select", category, matchId: matchId.data };
    }
    if (kindWire === "m") {
      return undefined;
    }
  }
  if (segments.length === 6) {
    const kindWire = segments[2];
    const category = categoryFromWire(segments[3] ?? "");
    const matchId = MatchIdSchema.safeParse(segments[4]);
    const nomineeRaw = segments[5];
    if (
      kindWire !== "m" ||
      nomineeRaw === undefined ||
      category === undefined ||
      !matchId.success ||
      !/^\d$/u.test(nomineeRaw)
    ) {
      return undefined;
    }
    return {
      kind: "modal",
      category,
      matchId: matchId.data,
      nomineeIndex: Number.parseInt(nomineeRaw, 10),
    };
  }
  return undefined;
}
