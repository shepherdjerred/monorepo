import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { HistoryScope, RecordMedia } from "./types.ts";
import {
  withMode,
  withSpoken,
} from "@shepherdjerred/streambot/sources/source.ts";
export type PlaybackStart = {
  readonly requestId?: string;
  readonly scope: HistoryScope;
  readonly media: RecordMedia;
  readonly positionSeconds?: number;
  readonly nowMs?: number;
};
export function recordPlaybackRun(
  database: Database,
  input: PlaybackStart,
  upsert: () => string,
): string {
  if (input.requestId !== undefined) {
    const open = database
      .query(
        "SELECT id FROM playback_runs WHERE queue_request_id = ?1 AND ended_at IS NULL AND guild_id = ?2 AND channel_id = ?3 AND user_id = ?4",
      )
      .get(
        input.requestId,
        input.scope.guildId,
        input.scope.channelId,
        input.scope.userId,
      );
    if (open !== null) return z.object({ id: z.string() }).parse(open).id;
  }
  const mediaItemId = upsert();
  const runId = crypto.randomUUID();
  const nowMs = input.nowMs ?? Date.now();
  database
    .query(
      `INSERT INTO playback_runs
          (id, queue_request_id, media_item_id, guild_id, channel_id, user_id, started_at, start_position_seconds, title, provider, source_json, thumbnail_url, duration_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .run(
      runId,
      input.requestId ?? null,
      mediaItemId,
      input.scope.guildId,
      input.scope.channelId,
      input.scope.userId,
      nowMs,
      input.positionSeconds ?? 0,
      input.media.title,
      input.media.provider,
      JSON.stringify(
        withSpoken(withMode(input.media.source, undefined), undefined),
      ),
      input.media.thumbnailUrl ?? null,
      input.media.durationSeconds ?? null,
    );
  if (input.requestId !== undefined) {
    database
      .query(
        "UPDATE queue_requests SET status = 'started' WHERE id = ?1 AND status = 'queued'",
      )
      .run(input.requestId);
  }
  return runId;
}
