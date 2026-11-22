import type { Database } from "bun:sqlite";
import { z } from "zod";
import { MediaIntentSchema } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import { isBlockedText } from "@shepherdjerred/streambot/moderation/adult-block.ts";

const QueueRequestRowSchema = z.object({
  raw_query: z.string(),
  intent_json: z.string(),
  status: z.string(),
  title: z.string().nullable(),
});

function extractIntentQuery(
  rawQuery: string,
  intentJson: string,
): string | null {
  const trimmed = rawQuery.trim();
  if (
    trimmed.length === 0 ||
    /^https?:\/\//iu.test(trimmed) ||
    trimmed.startsWith("radio:") ||
    trimmed.startsWith("tv:") ||
    isBlockedText(trimmed)
  ) {
    return null;
  }
  try {
    const parsed = MediaIntentSchema.safeParse(JSON.parse(intentJson));
    if (parsed.success) {
      if (parsed.data.mode === "video") return null;
      const combined =
        parsed.data.performer === undefined || parsed.data.work === undefined
          ? parsed.data.query
          : `${parsed.data.performer} - ${parsed.data.work}`;
      return isBlockedText(combined) ? null : combined.slice(0, 120);
    }
  } catch {
    /* Fall back to raw_query when intent JSON cannot be parsed. */
  }
  return trimmed.slice(0, 120);
}

function queryRecentQueueRows(input: {
  readonly database: Database;
  readonly guildId: string;
  readonly scope: "room" | "mine" | "server";
  readonly targetUsers: readonly string[];
}) {
  if (input.scope === "server") {
    return z.array(QueueRequestRowSchema).parse(
      input.database
        .query(
          `SELECT q.raw_query, q.intent_json, q.status, m.title
             FROM queue_requests q
             LEFT JOIN media_items m ON m.id = q.media_item_id
            WHERE q.guild_id = ?1
            ORDER BY q.created_at DESC
            LIMIT 60`,
        )
        .all(input.guildId),
    );
  }
  if (input.targetUsers.length === 0) return [];
  const placeholders = input.targetUsers
    .map((_, index) => `?${String(index + 1)}`)
    .join(", ");
  return z.array(QueueRequestRowSchema).parse(
    input.database
      .query(
        `SELECT q.raw_query, q.intent_json, q.status, m.title
           FROM queue_requests q
           LEFT JOIN media_items m ON m.id = q.media_item_id
          WHERE q.user_id IN (${placeholders})
          ORDER BY q.created_at DESC
          LIMIT 60`,
      )
      .all(...input.targetUsers),
  );
}

export function collectTasteQueueSignals(input: {
  readonly database: Database;
  readonly guildId: string;
  readonly scope: "room" | "mine" | "server";
  readonly targetUsers: readonly string[];
  readonly skippedSet: Set<string>;
}): string[] {
  const rows = queryRecentQueueRows(input);
  const queries: string[] = [];
  const seenQueries = new Set<string>();
  for (const row of rows) {
    if (
      (row.status === "skipped" || row.status === "removed") &&
      row.title !== null &&
      !isBlockedText(row.title)
    ) {
      input.skippedSet.add(row.title);
      continue;
    }
    if (row.status === "failed") continue;
    const candidateText = extractIntentQuery(row.raw_query, row.intent_json);
    if (candidateText === null) continue;
    const key = candidateText.toLowerCase();
    if (!seenQueries.has(key)) {
      seenQueries.add(key);
      queries.push(candidateText);
      if (queries.length >= 12) break;
    }
  }
  return queries;
}
