import type { Database } from "bun:sqlite";
import { z } from "zod";
import {
  SourceSchema,
  type Source,
  withMode,
  withSpoken,
} from "@shepherdjerred/streambot/sources/source.ts";
import { MusicError } from "./errors.ts";

const RowSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  user_id: z.string(),
  guild_id: z.string().nullable(),
  revision: z.number(),
});
const ItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  source_json: z.string(),
});
export type PlaylistViewer = { userId: string; guildId: string };
export type PlaylistEntry = { id: string; title: string; source: Source };
export type Playlist = z.infer<typeof RowSchema> & { items: PlaylistEntry[] };
export type PlaylistContent = { title: string; source: Source };

/** Uses the existing database; saved playlists have no dependency on playback-history recording. */
export class PlaylistStore {
  constructor(private readonly db: Database) {
    db.run(`CREATE TABLE IF NOT EXISTS music_playlists (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, guild_id TEXT,
      revision INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, name));
      CREATE TABLE IF NOT EXISTS music_playlist_items (
      id TEXT PRIMARY KEY, playlist_id TEXT NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, title TEXT NOT NULL, source_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS music_playlist_order ON music_playlist_items(playlist_id, position);
      CREATE TABLE IF NOT EXISTS music_playlist_migrations (id TEXT PRIMARY KEY);`);
    const migrate = db.transaction(() => {
      if (
        db
          .query(
            "SELECT id FROM music_playlist_migrations WHERE id = 'saved-queues-v1'",
          )
          .get() !== null
      )
        return;
      db.run(
        "INSERT INTO music_playlists(id,user_id,name) SELECT id,user_id,name FROM saved_queues",
      );
      const rows = z
        .array(
          z.object({
            saved_queue_id: z.string(),
            position: z.number(),
            title: z.string(),
            source_json: z.string(),
          }),
        )
        .parse(
          db
            .query(
              "SELECT q.saved_queue_id,q.position,m.title,m.source_json FROM saved_queue_items q JOIN media_items m ON m.id=q.media_item_id",
            )
            .all(),
        );
      for (const row of rows) {
        SourceSchema.parse(JSON.parse(row.source_json));
        db.query(
          "INSERT INTO music_playlist_items VALUES (?1,?2,?3,?4,?5)",
        ).run(
          crypto.randomUUID(),
          row.saved_queue_id,
          row.position,
          row.title,
          row.source_json,
        );
      }
      db.run(
        "INSERT INTO music_playlist_migrations VALUES ('saved-queues-v1')",
      );
    });
    migrate();
  }
  list(viewer: PlaylistViewer, scope: "mine" | "server") {
    const rows = z
      .array(
        RowSchema.extend({
          count: z.number(),
          cover_json: z.string().nullable(),
        }),
      )
      .parse(
        this.db
          .query(
            `SELECT p.*,COUNT(i.id) AS count,
      (SELECT source_json FROM music_playlist_items WHERE playlist_id=p.id ORDER BY position,id LIMIT 1) AS cover_json
      FROM music_playlists p LEFT JOIN music_playlist_items i ON i.playlist_id=p.id
      WHERE ${scope === "mine" ? "p.user_id=?1" : "p.guild_id=?1"} GROUP BY p.id ORDER BY p.name,p.id`,
          )
          .all(scope === "mine" ? viewer.userId : viewer.guildId),
      );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.user_id,
      guildId: row.guild_id,
      revision: row.revision,
      count: row.count,
      owned: row.user_id === viewer.userId,
      ...(row.cover_json === null
        ? {}
        : { cover: SourceSchema.parse(JSON.parse(row.cover_json)).music }),
    }));
  }
  read(id: string, viewer: PlaylistViewer): Playlist {
    const raw = this.db
      .query("SELECT * FROM music_playlists WHERE id=?1")
      .get(id);
    if (raw === null)
      throw new MusicError(
        404,
        "playlist_missing",
        "This playlist is unavailable.",
      );
    const row = RowSchema.parse(raw);
    if (row.user_id !== viewer.userId && row.guild_id !== viewer.guildId)
      throw new MusicError(
        404,
        "playlist_missing",
        "This playlist is unavailable.",
      );
    const items = z
      .array(ItemSchema)
      .parse(
        this.db
          .query(
            "SELECT id,title,source_json FROM music_playlist_items WHERE playlist_id=?1 ORDER BY position,id",
          )
          .all(id),
      )
      .map((item) => ({
        id: item.id,
        title: item.title,
        source: SourceSchema.parse(JSON.parse(item.source_json)),
      }));
    return { ...row, items };
  }
  create(
    viewer: PlaylistViewer,
    name: string,
    content: readonly PlaylistContent[] = [],
  ): Playlist {
    z.string().trim().min(1).max(100).parse(name);
    if (
      this.db
        .query("SELECT id FROM music_playlists WHERE user_id=?1 AND name=?2")
        .get(viewer.userId, name) !== null
    )
      throw new MusicError(
        409,
        "playlist_name",
        "You already have a playlist with this name. Choose another name.",
      );
    const id = crypto.randomUUID();
    this.db.transaction(() => {
      this.db
        .query("INSERT INTO music_playlists(id,user_id,name) VALUES (?1,?2,?3)")
        .run(id, viewer.userId, name);
      this.writeItems(
        id,
        content.map((item) => ({ ...item, id: crypto.randomUUID() })),
      );
    })();
    return this.read(id, viewer);
  }
  edit(
    id: string,
    viewer: PlaylistViewer,
    revision: number,
    change: (playlist: Playlist) => void,
  ): Playlist {
    return this.db.transaction(() => {
      const playlist = this.read(id, viewer);
      if (playlist.user_id !== viewer.userId)
        throw new MusicError(
          403,
          "playlist_owner",
          "Only the owner can edit this playlist. Make your own copy to change it.",
        );
      if (playlist.revision !== revision)
        throw new MusicError(
          409,
          "playlist_changed",
          "This playlist changed. Refresh it before editing.",
        );
      change(playlist);
      const duplicate = this.db
        .query(
          "SELECT id FROM music_playlists WHERE user_id=?1 AND name=?2 AND id<>?3",
        )
        .get(viewer.userId, playlist.name, id);
      if (duplicate !== null)
        throw new MusicError(
          409,
          "playlist_name",
          "You already have a playlist with this name.",
        );
      this.db
        .query(
          "UPDATE music_playlists SET name=?1,guild_id=?2,revision=revision+1 WHERE id=?3",
        )
        .run(playlist.name, playlist.guild_id, id);
      this.writeItems(id, playlist.items);
      return this.read(id, viewer);
    })();
  }
  delete(id: string, viewer: PlaylistViewer, revision: number): void {
    this.db.transaction(() => {
      const playlist = this.read(id, viewer);
      if (playlist.user_id !== viewer.userId)
        throw new MusicError(
          403,
          "playlist_owner",
          "Only the owner can delete this playlist.",
        );
      if (playlist.revision !== revision)
        throw new MusicError(
          409,
          "playlist_changed",
          "This playlist changed. Refresh it before deleting.",
        );
      this.db.query("DELETE FROM music_playlists WHERE id=?1").run(id);
    })();
  }
  private writeItems(id: string, items: readonly PlaylistEntry[]) {
    this.db
      .query("DELETE FROM music_playlist_items WHERE playlist_id=?1")
      .run(id);
    items.forEach((item, position) =>
      this.db
        .query("INSERT INTO music_playlist_items VALUES (?1,?2,?3,?4,?5)")
        .run(
          item.id,
          id,
          position,
          item.title,
          JSON.stringify(
            withSpoken(
              withMode(SourceSchema.parse(item.source), undefined),
              undefined,
            ),
          ),
        ),
    );
  }
  /** Legacy command adapters retain their name-based private saved-queue contract. */
  saveLegacy(userId: string, name: string, items: readonly PlaylistContent[]) {
    const viewer = { userId, guildId: "" };
    const old = this.list(viewer, "mine").find((item) => item.name === name);
    if (old === undefined) this.create(viewer, name, items);
    else
      this.edit(old.id, viewer, old.revision, (playlist) => {
        playlist.items = items.map((item) => ({
          ...item,
          id: crypto.randomUUID(),
        }));
      });
  }
}
