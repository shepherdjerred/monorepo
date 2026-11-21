import { WebError } from "@shepherdjerred/streambot/web/server/errors.ts";
import type { WebPlayback } from "@shepherdjerred/streambot/web/server/playback.ts";
import type { WebSession } from "@shepherdjerred/streambot/web/server/session-store.ts";
import { buildRoom, type RoomOwner } from "./room-snapshot.ts";
import { RoomStreams } from "./room-streams.ts";

/** `GET /api/room` and `GET /api/room/events`: the viewer's whole room, once and pushed. */
export class WebRoomRoutes {
  readonly streams: RoomStreams;
  private readonly owner: RoomOwner;

  constructor(
    playback: WebPlayback,
    plexPostersEnabled: (guildId: string, userId: string) => Promise<boolean>,
    limits: { perSession?: number; global?: number } = {},
  ) {
    this.owner = {
      deps: playback.deps,
      authorize: (session, guild) => playback.authorize(session, guild),
      sportsEnabled: (session, guild) => playback.sportsEnabled(session, guild),
      historyEnabled: (session, guild) =>
        playback.historyEnabled(session, guild),
      requesterName: (session, guild, user) =>
        playback.requesterName(session, guild, user),
      plexPostersEnabled,
    };
    this.streams = new RoomStreams({
      hub: playback.deps.sessions.changes,
      owner: this.owner,
      ...limits,
    });
  }

  /** Null when the path is not a room route. */
  async handle(
    request: Request,
    url: URL,
    session: WebSession,
    reauthenticate: () => WebSession,
  ): Promise<Response | null> {
    if (url.pathname !== "/api/room" && url.pathname !== "/api/room/events")
      return null;
    if (request.method !== "GET")
      throw new WebError(405, "method", "This method is not supported.");
    const guildHint = url.searchParams.get("guildId");
    if (url.pathname === "/api/room")
      return Response.json(await buildRoom(this.owner, session, guildHint));
    return await this.streams.open({
      request,
      session,
      reauthenticate,
      guildHint,
    });
  }
}
