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
  PlaybackTimelineQuerySchema,
  PlaybackTimelineSchema,
  SealPlaybackHandoffSchema,
  PlaybackHandoffStatusSchema,
} from "#shared/household/playback.ts";
import {
  PlexHistoricalViewImportSchema,
  PlexHistoricalViewQuerySchema,
  type PlexHistoricalViewImport,
  type PlexHistoricalViewQuery,
  type PlexHistoricalViews,
} from "#shared/household/plex-history.ts";
import { parseInput, readJson } from "#server/validation.ts";

export function registerPlexHistoricalViewRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: {
    list: (
      actor: MediaActor,
      query: PlexHistoricalViewQuery,
    ) => Promise<PlexHistoricalViews>;
    import: (
      actor: MediaActor,
      input: PlexHistoricalViewImport,
    ) => Promise<{ imported: number; unchanged: number }>;
  },
) {
  app.get("/api/v1/requests/plex-history", async (c) =>
    c.json(
      await service.list(
        c.get("actor"),
        parseInput(PlexHistoricalViewQuerySchema, c.req.query()),
      ),
    ),
  );
  app.post("/api/v1/admin/playback/plex-history/import", async (c) =>
    c.json(
      await service.import(
        c.get("actor"),
        parseInput(PlexHistoricalViewImportSchema, await readJson(c.req.raw)),
      ),
    ),
  );
}

export function registerPlaybackRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: PlaybackHistoryApplication,
) {
  app.get("/api/v1/playback/people", async (c) =>
    c.json(PlaybackPeopleSchema.parse(await service.people(c.get("actor")))),
  );
  app.get("/api/v1/playback/history", async (c) => {
    const query = c.req.query();
    const actor = c.get("actor");
    const payload =
      query["view"] === "timeline"
        ? PlaybackTimelineSchema.parse(
            await service.timeline(
              actor,
              parseInput(PlaybackTimelineQuerySchema, query),
            ),
          )
        : PlaybackHistorySchema.parse(
            await service.history(
              actor,
              parseInput(PlaybackQuerySchema, query),
            ),
          );
    return c.json(payload);
  });
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
