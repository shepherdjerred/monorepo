import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";

const scope = { guildId: "one", channelId: "voice", userId: "me" };
const media = {
  title: "First game",
  provider: "streameast" as const,
  source: { kind: "url" as const, url: "https://v2.streameast.ga/game/" },
};
const browse = {
  ...scope,
  visibility: "mine" as const,
  query: "",
  provider: "",
  offset: 0,
};

test("history keeps individual runs, immutable titles, and resumes an open run only once", () => {
  const history = new MediaHistoryStore(":memory:");
  try {
    const requestId = history.recordQueueRequest({
      scope,
      media,
      rawQuery: media.title,
      intent: inferMediaIntent({ query: media.title }),
      nowMs: 1000,
    });
    const first = history.recordPlaybackStart({
      scope,
      media,
      requestId,
      nowMs: 2000,
    });
    expect(
      history.recordPlaybackStart({
        scope,
        media,
        requestId,
        nowMs: 3000,
        positionSeconds: 60,
      }),
    ).toBe(first);
    history.finishStartedRequest(requestId, "completed");
    history.recordPlaybackStart({
      scope,
      media: { ...media, title: "Second game" },
      requestId,
      nowMs: 4000,
    });
    const page = history.browseRuns(browse);
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.title)).toEqual([
      "Second game",
      "First game",
    ]);
    expect(page.items[1]).toMatchObject({
      started_at: 2000,
      created_at: 1000,
      outcome: "completed",
    });
  } finally {
    history.close();
  }
});

test("Mine and Server scopes are separate and pagination retains repeats", () => {
  const history = new MediaHistoryStore(":memory:");
  try {
    for (let index = 0; index < 52; index++)
      history.recordPlaybackStart({ scope, media, nowMs: index });
    history.recordPlaybackStart({
      scope: { ...scope, userId: "someone" },
      media,
      nowMs: 100,
    });
    history.recordPlaybackStart({
      scope: { ...scope, guildId: "two" },
      media,
      nowMs: 200,
    });
    expect(history.browseRuns(browse).total).toBe(53);
    expect(history.browseRuns({ ...browse, visibility: "server" }).total).toBe(
      53,
    );
    expect(history.browseRuns({ ...browse, offset: 50 }).items).toHaveLength(3);
    expect(history.browseRuns({ ...browse, provider: "youtube" }).total).toBe(
      0,
    );
    expect(history.browseRuns({ ...browse, query: "FIRST GAME" }).total).toBe(
      53,
    );
  } finally {
    history.close();
  }
});

test("legacy database upgrade preserves IDs, favorites, saved queues, and foreign keys", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "streambot-history-migration-"),
  );
  const file = path.join(directory, "history.sqlite");
  const legacy = new Database(file);
  legacy.run(`CREATE TABLE media_items (id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN ('local','youtube')), source_identity TEXT NOT NULL, source_json TEXT NOT NULL, title TEXT NOT NULL, canonical_url TEXT, channel_name TEXT, thumbnail_url TEXT, duration_seconds REAL, updated_at INTEGER NOT NULL, UNIQUE(provider, source_identity));
    CREATE TABLE queue_requests (id TEXT PRIMARY KEY, guild_id TEXT, channel_id TEXT, user_id TEXT, raw_query TEXT, intent_json TEXT, media_item_id TEXT REFERENCES media_items(id), status TEXT, error_code TEXT, created_at INTEGER);
    CREATE TABLE playback_runs (id TEXT PRIMARY KEY, queue_request_id TEXT REFERENCES queue_requests(id), media_item_id TEXT REFERENCES media_items(id), guild_id TEXT, channel_id TEXT, user_id TEXT, started_at INTEGER, ended_at INTEGER, outcome TEXT, start_position_seconds REAL);
    CREATE TABLE favorites (user_id TEXT, media_item_id TEXT REFERENCES media_items(id), created_at INTEGER, PRIMARY KEY(user_id, media_item_id));
    CREATE TABLE saved_queues (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at INTEGER, updated_at INTEGER, UNIQUE(user_id, name));
    CREATE TABLE saved_queue_items (saved_queue_id TEXT REFERENCES saved_queues(id), position INTEGER, media_item_id TEXT REFERENCES media_items(id), PRIMARY KEY(saved_queue_id,position));`);
  legacy
    .query(
      "INSERT INTO media_items VALUES ('item','youtube','url:https://youtu.be/old',?1,'Legacy title',NULL,NULL,NULL,100,0)",
    )
    .run(JSON.stringify({ kind: "url", url: "https://youtu.be/old" }));
  legacy.run(`INSERT INTO queue_requests VALUES ('request','one','voice','me','Legacy title','{}','item','completed',NULL,10);
    INSERT INTO playback_runs VALUES ('run','request','item','one','voice','me',20,30,'completed',0);
    INSERT INTO favorites VALUES ('me','item',0);
    INSERT INTO saved_queues VALUES ('saved','me','old queue',0,0);
    INSERT INTO saved_queue_items VALUES ('saved',0,'item');`);
  legacy.close();
  const history = new MediaHistoryStore(file);
  try {
    expect(history.browseRuns(browse).items[0]).toMatchObject({
      id: "run",
      title: "Legacy title",
    });
    expect(history.favorites("me")[0]?.title).toBe("Legacy title");
    expect(history.savedQueue("me", "old queue")[0]?.title).toBe(
      "Legacy title",
    );
    history.recordPlaybackStart({ scope, media, nowMs: 40 });
    const database = new Database(file);
    expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      database
        .query("SELECT id FROM media_items WHERE title = 'Legacy title'")
        .get(),
    ).toEqual({ id: "item" });
    database.close();
  } finally {
    history.close();
    await rm(directory, { recursive: true });
  }
});
