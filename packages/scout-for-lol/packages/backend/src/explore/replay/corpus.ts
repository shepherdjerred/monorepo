import { z } from "zod";
import { ExploreSurfaceSchema } from "#src/explore/surface.ts";

/**
 * The curated conversation corpus: identifiers only, never text.
 *
 * Every field here is a Prisma `uuid()` or a small enum. The questions people
 * asked and the answers they got are resolved from the stage snapshot at run
 * time, which keeps conversation text out of git and makes the corpus
 * self-verifying: if a pinned conversation is not in the snapshot the case
 * fails rather than drifting onto whatever is there now.
 */

/**
 * Where a turn's guild context came from.
 *
 * Capabilities are resolved per guild, so replaying a turn with the wrong
 * guild silently changes which tools existed — a capability question then
 * declines for a reason that has nothing to do with the model.
 *
 * - `run-payload` — exact. `ScoutInteractiveRun.payload` carries the
 *   `guildIds` that turn actually ran with (`ExploreDurablePayloadSchema`).
 * - `beta-allowlist` — derived, and certain on beta only: that stage's
 *   `EXPLORE_GUILD_ALLOWLIST` names exactly one guild, so no other guild could
 *   have produced the conversation. Not available on prod, which has no
 *   allowlist.
 *
 * There is deliberately no "assumed" member. A turn whose guild cannot be
 * established either way is left out of the corpus at curation time rather
 * than run with an empty list.
 */
export const ReplayGuildSourceSchema = z.enum([
  "run-payload",
  "beta-allowlist",
]);

export type ReplayGuildSource = z.infer<typeof ReplayGuildSourceSchema>;

/**
 * What kind of thing this conversation is.
 *
 * `dare-draft` conversations are opened by the Bryan Bucks flow with a
 * templated prompt ("Create one private ScoutQL-backed Dare v2 draft from this
 * exact request: …"), not by someone typing a question. Replaying them is
 * useful, but averaging them together with natural questions would let
 * templated text dominate a bundle's counts, so they stay countable apart.
 */
export const ReplayConversationKindSchema = z.enum(["question", "dare-draft"]);

export type ReplayConversationKind = z.infer<
  typeof ReplayConversationKindSchema
>;

export const ReplayCorpusTurnSchema = z
  .object({
    /** Position among this conversation's user turns, oldest first. */
    index: z.number().int().nonnegative(),
    questionMessageId: z.uuid(),
    /** The stored answer this replay is measured against. */
    answerMessageId: z.uuid(),
  })
  .strict();

export type ReplayCorpusTurn = z.infer<typeof ReplayCorpusTurnSchema>;

export const ReplayCorpusEntrySchema = z
  .object({
    conversationId: z.uuid(),
    /**
     * Pinned rather than read from `currentLeafId`.
     *
     * Messages form a tree and siblings are regenerations, so a later snapshot
     * in which the owner branched would otherwise silently change which
     * conversation the corpus means.
     */
    leafId: z.uuid(),
    kind: ReplayConversationKindSchema,
    surface: ExploreSurfaceSchema,
    guildSource: ReplayGuildSourceSchema,
    turns: z.array(ReplayCorpusTurnSchema).min(1),
    /** Curator's note. Never quoted user text — this file is committed. */
    note: z.string().min(1).max(300),
  })
  .strict();

export type ReplayCorpusEntry = z.infer<typeof ReplayCorpusEntrySchema>;

export const ReplayCorpusSchema = z
  .object({
    version: z.number().int().positive(),
    stage: z.enum(["beta", "prod"]),
    capturedAt: z.iso.datetime(),
    conversations: z.array(ReplayCorpusEntrySchema).min(1),
  })
  .strict();

export type ReplayCorpus = z.infer<typeof ReplayCorpusSchema>;

/** Every reason a corpus would not replay the way it reads. */
export function corpusIssues(corpus: ReplayCorpus): readonly string[] {
  const issues: string[] = [];

  const conversationIds = corpus.conversations.map(
    (entry) => entry.conversationId,
  );
  if (new Set(conversationIds).size !== conversationIds.length) {
    issues.push("a conversation appears more than once");
  }

  for (const entry of corpus.conversations) {
    const indices = entry.turns.map((turn) => turn.index);
    const sorted = [...indices].toSorted((left, right) => left - right);
    if (indices.join(",") !== sorted.join(",")) {
      issues.push(
        `${entry.conversationId}: turns are not in ascending order, so pinned history would replay out of sequence`,
      );
    }
    if (new Set(indices).size !== indices.length) {
      issues.push(`${entry.conversationId}: a turn index is repeated`);
    }
    const messageIds = entry.turns.flatMap((turn) => [
      turn.questionMessageId,
      turn.answerMessageId,
    ]);
    if (new Set(messageIds).size !== messageIds.length) {
      issues.push(`${entry.conversationId}: a message id is used twice`);
    }
    if (corpus.stage === "prod" && entry.guildSource === "beta-allowlist") {
      // Prod has no allowlist, so the derivation that makes this sound on beta
      // does not exist there.
      issues.push(
        `${entry.conversationId}: beta-allowlist guild source is not valid for a prod corpus`,
      );
    }
  }

  return issues;
}

export function parseReplayCorpus(raw: unknown): ReplayCorpus {
  const corpus = ReplayCorpusSchema.parse(raw);
  const issues = corpusIssues(corpus);
  if (issues.length > 0) {
    throw new Error(`Corpus is not replayable:\n  - ${issues.join("\n  - ")}`);
  }
  return corpus;
}

export function replayCorpusSha256(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}

/** How many cases a corpus contributes: one per turn, not one per conversation. */
export function corpusCaseCount(corpus: ReplayCorpus): number {
  return corpus.conversations.reduce(
    (total, entry) => total + entry.turns.length,
    0,
  );
}
