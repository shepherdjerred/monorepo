import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import type { PlaybackHistoryApplication } from "#application/playback-ports.ts";
import {
  ImportPlaybackHistorySchema,
  NowPlayingSchema,
  PlaybackHistorySchema,
  PlaybackPeopleSchema,
  PlaybackQuerySchema,
  PlaybackStatisticsSchema,
  SealPlaybackHandoffSchema,
  PlaybackHandoffStatusSchema,
} from "#shared/household/playback.ts";
import { parseInput, readJson } from "#server/validation.ts";

export function registerPlaybackRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: PlaybackHistoryApplication,
) {
  app.get("/api/v1/playback/people", async (c) =>
    c.json(PlaybackPeopleSchema.parse(await service.people(c.get("actor")))),
  );
  app.get("/api/v1/playback/history", async (c) =>
    c.json(
      PlaybackHistorySchema.parse(
        await service.history(
          c.get("actor"),
          parseInput(PlaybackQuerySchema, c.req.query()),
        ),
      ),
    ),
  );
  app.get("/api/v1/playback/statistics", async (c) =>
    c.json(
      PlaybackStatisticsSchema.parse(
        await service.statistics(
          c.get("actor"),
          parseInput(PlaybackQuerySchema, c.req.query()),
        ),
      ),
    ),
  );
  app.get("/api/v1/playback/now-playing", async (c) =>
    c.json(NowPlayingSchema.parse(await service.nowPlaying(c.get("actor")))),
  );
  app.post("/api/v1/admin/playback/import", async (c) =>
    c.json(
      await service.importHistory(
        c.get("actor"),
        parseInput(ImportPlaybackHistorySchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.post("/api/v1/admin/playback/seal", async (c) =>
    c.json(
      await service.sealHandoff(
        c.get("actor"),
        parseInput(SealPlaybackHandoffSchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.get("/api/v1/admin/playback/handoff", async (c) =>
    c.json(
      PlaybackHandoffStatusSchema.parse(
        await service.handoffStatus(c.get("actor")),
      ),
    ),
  );
}
