import type { ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Explore's stored copies of an erased player.
 *
 * Explore persists what a turn showed: tool payloads (`ExploreToolPayload`,
 * the inspection data a share link can open), the assistant turns a share link
 * renders (`ExploreMessage`), and the mirrored progress of durable runs
 * (`ScoutInteractiveRun`). A copy is any of those whose text names the player
 * by PUUID or by `gameName#tagLine`. Matching copies are redacted in place,
 * never deleted, so a conversation's tree and a share link's pinned leaf stay
 * intact and say that something was removed.
 */

export const ERASURE_REDACTION_NOTICE =
  "Removed: this answer included a player who asked Scout to erase their data.";

export type ExploreCopyCounts = {
  toolPayloads: number;
  messages: number;
  runs: number;
  /** Conversations with a live share link among those redacted. */
  sharedConversations: number;
};

type ExploreCopyDb = Pick<
  ExtendedPrismaClient,
  "exploreToolPayload" | "exploreMessage" | "scoutInteractiveRun"
>;

function like(needle: string) {
  return { contains: needle, mode: "insensitive" as const };
}

/** Every stored field of an assistant turn that can carry what it showed. */
function messageMatches(needle: string) {
  const match = like(needle);
  return [
    { content: match },
    { spokenContent: match },
    { queryText: match },
    { caveats: match },
    { followUps: match },
    { preview: match },
    { visualization: match },
    { matchCards: match },
    { loadoutCards: match },
    { inlineEntities: match },
    { trace: match },
  ];
}

function runMatches(needle: string) {
  const match = like(needle);
  return [
    { partialOutput: match },
    { trace: match },
    { activity: match },
    { preview: match },
  ];
}

async function findCopies(db: ExploreCopyDb, needles: readonly string[]) {
  const [toolPayloads, messages, runs] = await Promise.all([
    db.exploreToolPayload.findMany({
      where: { OR: needles.map((needle) => ({ payload: like(needle) })) },
      select: { id: true },
    }),
    db.exploreMessage.findMany({
      where: {
        role: "assistant",
        OR: needles.flatMap((needle) => messageMatches(needle)),
      },
      select: {
        id: true,
        conversationId: true,
        conversation: { select: { shareToken: true } },
      },
    }),
    db.scoutInteractiveRun.findMany({
      where: { OR: needles.flatMap((needle) => runMatches(needle)) },
      select: { id: true },
    }),
  ]);
  const shared = new Set(
    messages
      .filter((message) => message.conversation.shareToken !== null)
      .map((message) => message.conversationId),
  );
  return { toolPayloads, messages, runs, shared };
}

function counts(copies: Awaited<ReturnType<typeof findCopies>>) {
  return {
    toolPayloads: copies.toolPayloads.length,
    messages: copies.messages.length,
    runs: copies.runs.length,
    sharedConversations: copies.shared.size,
  };
}

function needlesOf(needles: readonly string[]): string[] {
  const usable = needles.filter((needle) => needle.length > 0);
  if (usable.length === 0) {
    throw new Error("An Explore copy search needs at least one identifier");
  }
  return usable;
}

/** What `redactExploreCopies` would change, without changing it. */
export async function countExploreCopies(
  db: ExploreCopyDb,
  needles: readonly string[],
): Promise<ExploreCopyCounts> {
  return counts(await findCopies(db, needlesOf(needles)));
}

/** Redact every stored Explore copy naming one of `needles`; running it again finds none. */
export async function redactExploreCopies(
  db: ExploreCopyDb,
  needles: readonly string[],
): Promise<ExploreCopyCounts> {
  const copies = await findCopies(db, needlesOf(needles));
  if (copies.toolPayloads.length > 0) {
    await db.exploreToolPayload.updateMany({
      where: { id: { in: copies.toolPayloads.map((row) => row.id) } },
      data: { payload: JSON.stringify({ redacted: ERASURE_REDACTION_NOTICE }) },
    });
  }
  if (copies.messages.length > 0) {
    await db.exploreMessage.updateMany({
      where: { id: { in: copies.messages.map((row) => row.id) } },
      data: {
        content: ERASURE_REDACTION_NOTICE,
        spokenContent: null,
        queryText: null,
        caveats: "[]",
        followUps: "[]",
        preview: null,
        visualization: null,
        matchCards: null,
        loadoutCards: null,
        inlineEntities: null,
        trace: null,
      },
    });
  }
  if (copies.runs.length > 0) {
    await db.scoutInteractiveRun.updateMany({
      where: { id: { in: copies.runs.map((row) => row.id) } },
      data: { partialOutput: null, trace: null, activity: null, preview: null },
    });
  }
  return counts(copies);
}
