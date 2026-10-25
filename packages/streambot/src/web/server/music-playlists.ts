import { z } from "zod";
import { PlaylistMutationSchema } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import type {
  Playlist,
  PlaylistViewer,
  PlaylistContent,
} from "@shepherdjerred/streambot/music/playlists.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import { CommandSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { WebMusicOwner } from "./music-owner.ts";
import type { WebSession } from "./session-store.ts";
import { WebError, requestInput, readRequestInput } from "./errors.ts";

export class WebPlaylists {
  constructor(private readonly music: WebMusicOwner) {}
  private store() {
    const store = this.music.playback.deps.commands.history?.playlists;
    if (store === undefined) throw new Error("Playlist storage is not wired");
    return store;
  }
  private viewer(session: WebSession, guildId: string): PlaylistViewer {
    return { userId: session.identity.userId, guildId };
  }
  sources(session: WebSession, guildId: string, id: string, revision: number) {
    const playlist = this.store().read(id, this.viewer(session, guildId));
    if (playlist.revision !== revision)
      throw new WebError(
        409,
        "playlist_changed",
        "This playlist changed. Open it again before playing.",
      );
    return playlist.items.map((item) => item.source);
  }
  private present(
    playlist: Playlist,
    session: WebSession,
    guildId: string,
    offset = 0,
  ) {
    return {
      id: playlist.id,
      name: playlist.name,
      ownerId: playlist.user_id,
      guildId: playlist.guild_id,
      revision: playlist.revision,
      count: playlist.items.length,
      owned: playlist.user_id === session.identity.userId,
      offset,
      items: playlist.items.slice(offset, offset + 50).map((item) => ({
        id: item.id,
        title: item.title,
        matched: item.source.kind === "url" && item.source.music !== undefined,
        selectionId: this.music.add(session, guildId, [item.source], {
          playlistId: playlist.id,
          revision: playlist.revision,
        }),
        ...(item.source.music === undefined
          ? {}
          : { music: item.source.music }),
      })),
    };
  }
  private async browse(url: URL, session: WebSession) {
    const guildId = url.searchParams.get("guildId") ?? "";
    await this.music.require(session, guildId, "playlists");
    const id = url.searchParams.get("id");
    const viewer = this.viewer(session, guildId);
    return Response.json(
      id === null
        ? this.store().list(
            viewer,
            requestInput(
              z.enum(["mine", "server"]),
              url.searchParams.get("scope") ?? "mine",
            ),
          )
        : this.present(
            this.store().read(
              requestInput(z.string().min(1).max(100), id),
              viewer,
            ),
            session,
            guildId,
            requestInput(
              z.coerce.number().int().nonnegative().max(100_000),
              url.searchParams.get("offset") ?? 0,
            ),
          ),
    );
  }
  private async save(
    input: z.infer<typeof PlaylistMutationSchema>,
    session: WebSession,
    viewer: PlaylistViewer,
  ) {
    const command = requestInput(CommandSchema, input.playback);
    if (command.guildId !== input.guildId)
      throw new WebError(
        400,
        "guild_changed",
        "Refresh the playback destination.",
      );
    const context = await this.music.playback.commandContext(session, {
      ...command,
      action: "volume",
      percent: 100,
    });
    context.guard();
    const view = context.handle.view();
    const content: PlaylistContent[] = [
      ...(view.current === null ? [] : [view.current]),
      ...view.queue,
    ].flatMap((item) =>
      item.source === undefined
        ? []
        : [{ title: item.title, source: item.source }],
    );
    if (content.length === 0)
      throw new MusicError(
        400,
        "queue_empty",
        "Queue a song before saving a playlist.",
      );
    return Response.json(
      this.present(
        this.store().create(
          viewer,
          requestInput(z.string().min(1), input.name),
          content,
        ),
        session,
        input.guildId,
      ),
    );
  }
  private editItem(
    value: Playlist,
    input: z.infer<typeof PlaylistMutationSchema>,
    session: WebSession,
  ) {
    const index = value.items.findIndex((item) => item.id === input.itemId);
    const item = value.items[index];
    if (item === undefined)
      throw new MusicError(
        409,
        "playlist_changed",
        "This playlist item is no longer available.",
      );
    if (input.action === "remove") value.items.splice(index, 1);
    else if (input.action === "move") {
      const position = requestInput(
        z.number().int().positive().max(value.items.length),
        input.position,
      );
      value.items.splice(index, 1);
      value.items.splice(position - 1, 0, item);
    } else {
      const replacement = this.music.get(
        session,
        input.guildId,
        input.selectionId ?? "",
      ).sources;
      if (
        replacement.length !== 1 ||
        replacement[0]?.music === undefined ||
        item.source.music?.id !== replacement[0].music.id ||
        item.source.music.provider !== replacement[0].music.provider
      )
        throw new WebError(
          400,
          "track_changed",
          "Choose a video for the same song.",
        );
      item.source = replacement[0];
    }
  }
  async handle(request: Request, url: URL, session: WebSession) {
    if (request.method === "GET") return await this.browse(url, session);
    if (request.method !== "POST")
      throw new WebError(405, "method", "This method is not supported.");
    const input = await readRequestInput(PlaylistMutationSchema, request);
    await this.music.require(session, input.guildId, "playlists");
    const viewer = this.viewer(session, input.guildId);
    if (input.action === "create")
      return Response.json(
        this.present(
          this.store().create(
            viewer,
            requestInput(z.string().min(1), input.name),
          ),
          session,
          input.guildId,
        ),
      );
    if (input.action === "save") return await this.save(input, session, viewer);
    const id = requestInput(z.string().min(1).max(100), input.id);
    if (input.action === "copy") {
      const original = this.store().read(id, viewer);
      return Response.json(
        this.present(
          this.store().create(
            viewer,
            input.name ?? original.name + " copy",
            original.items,
          ),
          session,
          input.guildId,
        ),
      );
    }
    const revision = requestInput(
      z.number().int().nonnegative(),
      input.revision,
    );
    if (input.action === "delete") {
      this.store().delete(id, viewer, revision);
      return Response.json({ message: "Playlist deleted." });
    }
    let current: PlaylistContent | undefined;
    if (input.action === "add" && input.playback !== undefined) {
      const command = requestInput(CommandSchema, input.playback);
      if (command.guildId !== input.guildId)
        throw new WebError(
          400,
          "guild_changed",
          "Refresh the playback destination.",
        );
      const context = await this.music.playback.commandContext(session, {
        ...command,
        action: "volume",
        percent: 100,
      });
      context.guard();
      const item = context.handle.view().current;
      if (item?.source === undefined)
        throw new MusicError(400, "queue_empty", "Nothing is playing.");
      current = { title: item.title, source: item.source };
    }
    if (input.selectionId !== undefined) {
      const selected = this.music.get(
        session,
        input.guildId,
        input.selectionId,
      );
      await this.music.require(session, input.guildId, selected.feature);
    }
    const playlist = this.store().edit(id, viewer, revision, (value) => {
      switch (input.action) {
        case "rename":
          value.name = requestInput(z.string().min(1), input.name);
          break;
        case "publish":
          value.guild_id = input.guildId;
          break;
        case "private":
          value.guild_id = null;
          break;
        case "add": {
          if (current !== undefined) {
            value.items.push({ ...current, id: crypto.randomUUID() });
            break;
          }
          const sources = this.music.get(
            session,
            input.guildId,
            input.selectionId ?? "",
          ).sources;
          value.items.push(
            ...sources.map((source) => ({
              id: crypto.randomUUID(),
              title:
                source.music === undefined
                  ? source.kind === "file"
                    ? source.title
                    : "Saved media"
                  : source.music.artists.join(", ") +
                    " — " +
                    source.music.title,
              source,
            })),
          );
          break;
        }
        case "remove":
        case "move":
        case "match": {
          this.editItem(value, input, session);
          break;
        }
        case "create":
        case "copy":
        case "delete":
        case "save":
          throw new Error("Unexpected playlist operation");
      }
    });
    return Response.json(this.present(playlist, session, input.guildId));
  }
}
