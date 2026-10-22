import path from "node:path";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import {
  DiscordIdSchema,
  GameIdSchema,
  type GameId,
  type Player,
  type SessionView,
} from "@arcade/common/catalog.ts";
import {
  RoomRequestSchema,
  type Access,
  type RoomRequest,
} from "@arcade/common/protocol.ts";
import type { Socket } from "socket.io";
import {
  createGameSocket,
  type GameSocketChannel,
} from "@shepherdjerred/discord-plays-core/webserver/socket.ts";
import type { DiscordAuth } from "@shepherdjerred/discord-plays-core/auth/discord-oauth.ts";
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";
import type { Logger } from "@shepherdjerred/discord-plays-core/logger.ts";
import { IMAGE_FILE_OPTIONS } from "@shepherdjerred/discord-plays-core/webserver/image-file-options.ts";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import type { UserbotProvider } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool";
import { SessionManager } from "#src/session/manager.ts";
import { MediaFeeds } from "#src/media/feeds.ts";
import type { GameServerModule } from "#src/games/module.ts";
import type { StatsStore } from "#src/stats/store.ts";
import type { IncomingMessage } from "node:http";
import type { DriverFeedAdmission } from "@shepherdjerred/discord-plays-core/driver-feed/service.ts";
import { UserError } from "#src/errors.ts";

export type DiscordAccess = {
  knownGuild: (guildId: string) => boolean;
  players: (
    session: Pick<SessionView, "guildId" | "voiceChannelId">,
  ) => Player[];
  inVoice: (
    session: Pick<SessionView, "guildId" | "voiceChannelId">,
    userId: string,
  ) => boolean;
  moderator: (guildId: string, userId: string) => Promise<boolean>;
  startTarget: (
    guildId: string,
    userId: string,
  ) => Promise<{ voiceChannelId: string; textChannelId: string }>;
  servers: (
    userId: string,
  ) => Promise<{ id: string; name: string; voiceChannelName: string | null }[]>;
};

export function createApplication(options: {
  publicOrigin: string;
  webAssets: string;
  stateRoot: string;
  maxSessions: number;
  maxHeavySessions: number;
  auth: Pick<DiscordAuth, "identify">;
  access: DiscordAccess;
  pool: UserbotProvider<SelfbotPooledUserbot>;
  stats: StatsStore;
  logger: Logger;
  enabled: (gameId: GameId, guildId: string) => Promise<boolean>;
  modules: (
    feeds: MediaFeeds,
    statsChanged: (guildId: string, gameId: GameId) => void,
  ) => ReadonlyMap<GameId, GameServerModule<SelfbotPooledUserbot>>;
}) {
  const app: Express = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8kb" }));
  const server = createServer(app);
  const subscriptions = new WeakMap<
    Socket,
    { guildId: string; gameId: GameId }
  >();
  const moderatorScopes = new WeakMap<Socket, string>();
  const feeds = new MediaFeeds({
    server,
    logger: options.logger,
    admit: admitFeed,
  });
  async function admitFeed(
    id: string,
    request: IncomingMessage,
  ): Promise<DriverFeedAdmission> {
    const active = manager.session(id);
    const user = await options.auth.identify(request.headers.cookie);
    const socketId = new URL(
      request.url ?? "/",
      options.publicOrigin,
    ).searchParams.get("socketId");
    const holder =
      socketId === null ? undefined : channel.io.sockets.sockets.get(socketId);
    if (
      active === undefined ||
      user === undefined ||
      holder === undefined ||
      channel.identityOf(holder)?.discordId !== user.discordId
    )
      return {
        admitted: false,
        reason: "Sign in and join the game to watch",
      };
    const admitted = (): boolean =>
      holder.connected &&
      options.access.inVoice(active.view, user.discordId) &&
      (active.view.gameId === "emerald" || active.room.owns(id, holder.id)) &&
      manager.session(id)?.view.phase === "running";
    return admitted()
      ? { admitted: true, isStillAdmitted: admitted }
      : { admitted: false, reason: "Your controller is not active" };
  }
  const channel: GameSocketChannel<RoomRequest, DiscordUser> = createGameSocket(
    {
      server,
      isCorsEnabled: false,
      requestSchema: RoomRequestSchema,
      ownedUpgradePaths: feeds.upgradePaths,
      quietKinds: ["input"],
      identify: (cookie) => options.auth.identify(cookie),
      allowedOrigin: options.publicOrigin,
      logger: options.logger,
    },
  );
  const statsChanged = (guildId: string, gameId: GameId) => {
    channel.io.to(roomKey(guildId, gameId)).emit("stats-changed");
  };
  const manager = new SessionManager<SelfbotPooledUserbot>({
    pool: options.pool,
    modules: options.modules(feeds, statsChanged),
    stateRoot: options.stateRoot,
    maxSessions: options.maxSessions,
    maxHeavySessions: options.maxHeavySessions,
    changed: publish,
    error: (error) => {
      options.logger.error("arcade session failed", error);
    },
  });

  function privateAccess(socket: Socket, view: SessionView | null): Access {
    const user = channel.identityOf(socket);
    const active = view === null ? undefined : manager.session(view.id);
    const inVoice =
      view !== null &&
      user !== undefined &&
      options.access.inVoice(view, user.discordId);
    const running = view?.phase === "running";
    const seat = active?.room.seatOf(view?.id ?? "", socket.id) ?? null;
    return {
      sessionId: view?.id ?? null,
      seat,
      canPlay: inVoice && running,
      canWatch:
        inVoice && running && (view.gameId === "emerald" || seat !== null),
      canStop:
        view !== null &&
        (user?.discordId === view.startedByUserId ||
          moderatorScopes.get(socket) === view.guildId),
      reason: accessReason(user, view, inVoice),
    };
  }

  function publish(guildId: string, gameId: GameId): void {
    const snapshot = snapshotFor(guildId, gameId);
    channel.io.to(roomKey(guildId, gameId)).emit("room", snapshot);
    for (const socket of channel.io.sockets.sockets.values()) {
      const subscription = subscriptions.get(socket);
      if (subscription?.guildId !== guildId || subscription.gameId !== gameId)
        continue;
      socket.emit("access", privateAccess(socket, snapshot.session));
    }
  }

  function snapshotFor(guildId: string, gameId: GameId) {
    const snapshot = manager.room(guildId, gameId).snapshot();
    return {
      ...snapshot,
      participants:
        snapshot.session === null
          ? []
          : options.access.players(snapshot.session),
    };
  }

  const subscriptionRevision = new WeakMap<Socket, number>();
  channel.events.subscribe(({ socket, request }) => {
    void handleRequest(socket, request);
  });

  async function handleRequest(
    socket: Socket,
    request: RoomRequest,
  ): Promise<void> {
    try {
      if (request.kind === "subscribe") await subscribe(socket, request);
      else await control(socket, request);
    } catch (error) {
      if (!(error instanceof UserError))
        options.logger.error("arcade control failed", error);
      socket.emit(
        "denied",
        error instanceof UserError
          ? error.message
          : "Arcade could not apply that command.",
      );
    }
  }

  async function subscribe(
    socket: Socket,
    request: Extract<RoomRequest, { kind: "subscribe" }>,
  ): Promise<void> {
    if (!options.access.knownGuild(request.guildId))
      throw new UserError(404, "Arcade is not in this server.");
    const revision = (subscriptionRevision.get(socket) ?? 0) + 1;
    subscriptionRevision.set(socket, revision);
    subscriptions.delete(socket);
    moderatorScopes.delete(socket);
    releaseControls(socket);
    for (const room of socket.rooms) {
      if (subscriptionRevision.get(socket) !== revision) return;
      if (room !== socket.id) await socket.leave(room);
    }
    const user = channel.identityOf(socket);
    const moderator =
      user !== undefined &&
      (await options.access.moderator(request.guildId, user.discordId));
    if (!socket.connected || subscriptionRevision.get(socket) !== revision)
      return;
    subscriptions.set(socket, request);
    if (moderator) moderatorScopes.set(socket, request.guildId);
    await socket.join(roomKey(request.guildId, request.gameId));
    if (subscriptionRevision.get(socket) !== revision) return;
    const room = snapshotFor(request.guildId, request.gameId);
    socket.emit("room", room);
    socket.emit("access", privateAccess(socket, room.session));
  }

  function releaseControls(socket: Socket): void {
    for (const session of manager.list())
      manager.room(session.guildId, session.gameId).release(socket.id);
  }

  async function control(
    socket: Socket,
    request: Exclude<RoomRequest, { kind: "subscribe" }>,
  ): Promise<void> {
    const active = manager.session(request.sessionId);
    if (active?.view.phase !== "running")
      throw new UserError(409, "This game session has ended.");
    const subscription = subscriptions.get(socket);
    if (
      subscription?.guildId !== active.view.guildId ||
      subscription.gameId !== active.view.gameId
    )
      throw new UserError(
        403,
        "Open this game’s room before using its controls.",
      );
    const user = channel.identityOf(socket);
    if (
      user === undefined ||
      !options.access.inVoice(active.view, user.discordId)
    )
      throw new UserError(403, "Join the voice channel to play.");
    switch (request.kind) {
      case "claim": {
        const result = active.room.claim(
          request.sessionId,
          socket.id,
          publicPlayer(user),
          request.seat,
        );
        if (result !== "claimed")
          throw new UserError(
            409,
            result === "taken"
              ? "Someone has that controller already."
              : "The game is not ready.",
          );
        break;
      }
      case "release":
        active.room.release(socket.id);
        break;
      case "input":
        active.room.input(request.sessionId, socket.id, request.state);
        break;
      case "command": {
        const command = active.runtime?.command;
        if (command === undefined)
          throw new UserError(400, "This game uses individual controllers.");
        await command(publicPlayer(user), request.command);
      }
    }
  }
  channel.io.on("connection", (socket) => {
    socket.once("disconnect", () => {
      for (const session of manager.list())
        manager.room(session.guildId, session.gameId).release(socket.id);
    });
  });

  app.get("/api/servers", async (request, response) => {
    const user = await requireUser(request);
    response.json(await options.access.servers(user.discordId));
  });
  app.get("/api/sessions", (request, response) => {
    response.json(
      manager.list(DiscordIdSchema.parse(request.query["guildId"])),
    );
  });
  app.get("/api/stats", async (request, response) => {
    const query = z
      .object({
        guildId: DiscordIdSchema,
        gameId: GameIdSchema,
        playerId: DiscordIdSchema.optional(),
      })
      .parse(request.query);
    response.json(
      await options.stats.read(query.guildId, query.gameId, query.playerId),
    );
  });
  app.post("/api/sessions", async (request, response) => {
    const user = await requireMutation(request);
    const input = z
      .strictObject({ guildId: DiscordIdSchema, gameId: GameIdSchema })
      .parse(request.body);
    if (!(await options.enabled(input.gameId, input.guildId)))
      throw new UserError(409, "This game is not available yet.");
    const target = await options.access.startTarget(
      input.guildId,
      user.discordId,
    );
    const result = await manager.start({
      ...input,
      ...target,
      startedByUserId: user.discordId,
    });
    if (result.kind === "failed") {
      options.logger.error("game start failed", result.error);
      throw new UserError(
        500,
        "The game could not start. Your previous save is safe.",
      );
    }
    if (
      result.kind === "started" ||
      result.kind === "occupied" ||
      result.kind === "save-in-use"
    )
      response.status(result.kind === "started" ? 201 : 409).json(result);
    else throw new UserError(409, startMessage(result.kind));
  });
  app.delete("/api/sessions/:id", async (request, response) => {
    const user = await requireMutation(request);
    const id = z.uuid().parse(request.params.id);
    const active = manager.session(id);
    if (active === undefined)
      throw new UserError(404, "This game has already ended.");
    const result = await manager.stop(id, {
      userId: user.discordId,
      moderator: await options.access.moderator(
        active.view.guildId,
        user.discordId,
      ),
    });
    if (result.kind === "forbidden")
      throw new UserError(
        403,
        "Only the host or a server moderator can stop this game.",
      );
    if (result.kind === "not-active")
      throw new UserError(404, "This game has already ended.");
    if (result.error !== undefined)
      throw new UserError(
        500,
        "The game stopped, but its latest progress could not be saved.",
      );
    response.status(204).end();
  });
  app.post("/api/sessions/:id/goal", async (request, response) => {
    const user = await requireMutation(request);
    const active = manager.session(z.uuid().parse(request.params.id));
    if (active === undefined) throw new UserError(404, "This game has ended.");
    if (active.view.startedByUserId !== user.discordId)
      throw new UserError(403, "Only this session’s host can set a goal.");
    const { objective } = z
      .strictObject({ objective: z.string().trim().min(1).max(1000) })
      .parse(request.body);
    if (active.runtime?.goal === undefined)
      throw new UserError(400, "Goals are not available for this game.");
    await active.runtime.goal(objective);
    response.status(204).end();
  });
  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  async function requireUser(request: Request): Promise<DiscordUser> {
    const user = await options.auth.identify(request.headers.cookie);
    if (user === undefined)
      throw new UserError(401, "Sign in with Discord to play.");
    return user;
  }
  async function requireMutation(request: Request): Promise<DiscordUser> {
    if (request.headers.origin !== options.publicOrigin)
      throw new UserError(403, "Open Arcade directly to use its controls.");
    return requireUser(request);
  }

  function mountPages(): void {
    app.use(express.static(options.webAssets, IMAGE_FILE_OPTIONS));
    app.get(
      ["/", "/games/:game", "/servers/:guild/games/:game"],
      async (_request, response) => {
        // res.send derives the ETag from the page bytes (see IMAGE_FILE_OPTIONS).
        response
          .type("html")
          .send(await readFile(path.resolve(options.webAssets, "index.html")));
      },
    );
    app.use(
      (
        error: unknown,
        _request: Request,
        response: Response,
        _next: NextFunction,
      ) => {
        if (error instanceof UserError)
          response.status(error.status).type("text").send(error.message);
        else if (error instanceof z.ZodError)
          response.status(400).type("text").send("That request is not valid.");
        else {
          options.logger.error("arcade request failed", error);
          response
            .status(500)
            .type("text")
            .send("Arcade could not complete that request.");
        }
      },
    );
  }

  return { app, server, channel, manager, publish, statsChanged, mountPages };
}

function roomKey(guildId: string, gameId: GameId): string {
  return `${guildId}:${gameId}`;
}

function accessReason(
  user: DiscordUser | undefined,
  view: SessionView | null,
  inVoice: boolean,
): string | null {
  if (user === undefined) return "Sign in with Discord to play.";
  if (view === null) return null;
  if (!inVoice) return "Join the game’s voice channel to play.";
  return view.phase === "running" ? null : "The game is getting ready.";
}
function publicPlayer(user: DiscordUser): Player {
  return {
    discordId: user.discordId,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}
function startMessage(
  kind: "capacity" | "heavy-capacity" | "no-account" | "disabled" | "cancelled",
): string {
  const messages = {
    capacity: "Both arcade machines are occupied. Try again when a game ends.",
    "heavy-capacity":
      "A Wii or Smash game is already running. MK64 and Emerald are still available.",
    "no-account": "No streaming account is available in this server.",
    disabled: "This game is not available yet.",
    cancelled: "Game startup was cancelled.",
  };
  return messages[kind];
}
