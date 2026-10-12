import { bootGameBot } from "@shepherdjerred/discord-plays-core/entry.ts";
import { buildMarioKartExtraCommands } from "./discord/slashCommands/index.ts";
import { MarioKartGameDriver } from "./lifecycle/mario-kart-driver.ts";
import { SeatManager } from "./input/seat-manager.ts";
import { createWebServer } from "./webserver/index.ts";
import { DriverFeedService } from "@shepherdjerred/discord-plays-core/driver-feed/service.ts";
import {
  resolveDriverFeedConfig,
  resolveDriverFeedVideo,
} from "@shepherdjerred/discord-plays-core/driver-feed/config.ts";
import { engineFormat } from "./engine/format.ts";
import { AUDIO_CHANNELS, DISPLAY_ASPECT } from "./emulator/constants.ts";
import { seatAdmission } from "./webserver/driver-feed-admission.ts";
import { MK64_SAVE_HISTORY_ENTRIES, prepareEngine } from "./engine/index.ts";
import { Events } from "discord.js";
import type { IdentifySocket } from "@shepherdjerred/discord-plays-core/webserver/socket.ts";
import {
  handleRequest,
  seatsResponse,
  statusFor,
  type PlayAccess,
  type StatsSource,
} from "./webserver/dispatch.ts";
import { logger } from "./logger.ts";
import { getConfig } from "./config/index.ts";
import {
  createPrisma,
  databaseUrl,
  disconnectPrisma,
} from "./database/index.ts";
import { createPrismaLeaderboardStore } from "./leaderboard/store.ts";
import { createPlayerDirectory } from "./auth/player-directory.ts";
import { createWebSessionStore } from "./auth/session-store.ts";
import { DiscordAuth, mountAuthRoutes } from "./auth/discord-oauth.ts";
import { authBootstrapFromEnv } from "./auth/bootstrap.ts";
import { botVoicePresence } from "./auth/voice-presence.ts";
import { toPlayerName } from "./auth/names.ts";
import { startEventLoopLagSampler } from "./observability/event-loop-lag.ts";
import { eventLoopLagMs } from "./observability/metrics.ts";
import type {
  DiscordUser,
  LeaderboardResponse,
  RecentRacesResponse,
  SeatResponse,
} from "@discord-plays-mario-kart/common";

/** When no session is active, expose a zero-seat manager so claims are rejected. */
const NULL_SEAT_MANAGER = new SeatManager(0);

// Main-thread stall visibility: bridge parsing, overlays, and stream/ffmpeg I/O
// all live here.
startEventLoopLagSampler((lagMs) => {
  eventLoopLagMs.observe({ thread: "main" }, lagMs);
});

const config = await getConfig();

// Engine preparation runs before anything connects: it extracts the
// ROM-derived game archive (cached on the saves volume), and a missing install
// or an unsupported ROM fails startup instead of `/play`. With the emulator
// disabled (the ROM-free image smoke), nothing is prepared and `/play` refuses.
const build = config.emulator.enabled ? await prepareEngine(config) : undefined;
logger.info("game engine", {
  prepared: build !== undefined,
  ...(build === undefined ? {} : { binary: build.binary }),
});

// Low-latency in-browser video for seated players, alongside (never instead of)
// the Go-Live stream spectators watch. Constructed before the driver so sessions
// can drive it, but its WebSocket route is mounted once the HTTP server exists.
// Env overrides win over the 1Password config.toml so the feed can be enabled
// and its bandwidth dialled without a vault edit.
const driverFeedConfig = resolveDriverFeedConfig(config.driver_feed, Bun.env);
const driverFeed = driverFeedConfig.enabled
  ? new DriverFeedService({
      config: driverFeedConfig,
      video: resolveDriverFeedVideo(config.stream.video, Bun.env),
      source: { ...engineFormat(config), pixelFormat: "bgra" },
      audio: {
        sampleRate: engineFormat(config).audioSampleRate,
        channels: AUDIO_CHANNELS,
      },
      displayAspect: DISPLAY_ASPECT,
      logger,
    })
  : undefined;

// Race history and player identities share the leaderboard database. The page
// shows stats with or without a game running, so the store outlives sessions.
const prisma = createPrisma(databaseUrl(config.leaderboard.db_path));
const players = createPlayerDirectory(prisma);
const stats = createPrismaLeaderboardStore(prisma, players);

// One userbot, one emulator, one game at a time. The "pool" in the shared lib is
// general-purpose (Streambot uses it for many concurrent streams); for this single-slot
// game-bot we just feed it the single configured userbot token.
const driver = new MarioKartGameDriver({ config, build, driverFeed, stats });
driverFeed?.setAdmission(
  seatAdmission((socketId) => {
    const active = driver.getActiveRuntime();
    return active !== null && active.seatManager.seatOf(socketId) !== null;
  }),
);

const runtime = bootGameBot({
  serviceName: "discord-plays-mario-kart",
  sentryDsn: "https://c2f90a5857e940e1997b49791d9fc684@bugsink.sjer.red/13",
  logger,
  wiring: {
    botToken: config.bot.discord_token,
    applicationId: config.bot.application_id,
    userbotTokens: [config.stream.userbot.token],
    driver,
    stateRootDir: config.state_root_dir,
    saveHistory: { entries: MK64_SAVE_HISTORY_ENTRIES, keep: 50 },
    extraCommands: (botClient) =>
      buildMarioKartExtraCommands({
        driver,
        botClient,
        screenshotEnabled: config.bot.commands.screenshot.enabled,
      }),
  },
  onShutdown: async () => {
    try {
      await disconnectPrisma();
    } catch (error) {
      logger.error("disconnectPrisma failed", error);
    }
  },
});

driver.setBotClient(runtime.bot);

await runtime.start();

// ---- web server: the up-to-4 virtual controllers + leaderboard broadcasts ----
if (config.web.enabled) {
  // Discord sign-in gates the seats, so the API refuses to start without it.
  let auth: DiscordAuth | undefined;
  if (config.web.api.enabled) {
    const bootstrap = authBootstrapFromEnv(Bun.env);
    auth = new DiscordAuth({
      config: {
        publicOrigin: bootstrap.publicOrigin,
        clientId: config.bot.application_id,
        clientSecret: bootstrap.clientSecret,
      },
      sessions: createWebSessionStore(prisma, players),
    });
  }
  const signedIn = auth;
  const identify: IdentifySocket<DiscordUser> = (cookieHeader) =>
    signedIn === undefined
      ? Promise.resolve(undefined)
      : signedIn.identify(cookieHeader);

  const { socket, server, app } = createWebServer({
    port: config.web.port,
    webAssetsPath: config.web.assets,
    isApiEnabled: config.web.api.enabled,
    isCorsEnabled: config.web.cors,
    identify,
  });
  if (signedIn !== undefined) mountAuthRoutes(app, signedIn);
  // Shares the HTTP server with Socket.IO but takes its own upgrade path, so
  // video bytes never queue behind a controller input on one TCP connection.
  driverFeed?.attach(server);
  if (socket) {
    const voice = botVoicePresence(runtime.bot);
    const sessionChannel = () => {
      const active = driver.getActiveRuntime();
      return active === null
        ? undefined
        : {
            guildId: active.session.guildId,
            voiceChannelId: active.session.voiceChannelId,
          };
    };
    const rememberPlayer = async (user: DiscordUser) => {
      try {
        await players.upsert(user);
      } catch (error) {
        logger.warn("remembering a seated player failed", error);
      }
    };
    const access: PlayAccess = {
      identityOf: socket.identityOf,
      voiceChannel: () => {
        const channel = sessionChannel();
        if (channel === undefined) return null;
        return {
          id: channel.voiceChannelId,
          name: voice.channelName(channel) ?? "the voice channel",
        };
      },
      blockerFor: (user) => {
        if (user === undefined) return "signed-out";
        const channel = sessionChannel();
        if (channel === undefined) return "no-session";
        return voice.isInChannel(channel, user.discordId)
          ? null
          : "not-in-voice";
      },
      seatUserFor: (user) => {
        const channel = sessionChannel();
        const nickname =
          channel === undefined
            ? undefined
            : voice.displayName(channel, user.discordId);
        return {
          ...user,
          name: toPlayerName([nickname, user.name], user.username),
        };
      },
      onSeated: (user) => {
        void rememberPlayer(user);
      },
    };
    // Stats follow the running game's server; with no game running, the
    // server that raced most recently.
    const statsSource: StatsSource = async () => {
      const active = driver.getActiveRuntime();
      if (active !== null) return active.leaderboardStore;
      const guildId = await stats.latestGuildId();
      return guildId === undefined ? undefined : stats.forGuild(guildId);
    };
    const io = socket.io;

    // A player who leaves the game's voice channel loses their seat at once,
    // and the feed with it (the feed admits only seated connections).
    runtime.bot.on(Events.VoiceStateUpdate, (_before, after) => {
      const active = driver.getActiveRuntime();
      if (active === null) return;
      if (after.guild.id !== active.session.guildId) return;
      if (after.channelId === active.session.voiceChannelId) return;
      const freed = active.seatManager.releaseUser(after.id);
      if (freed === null) return;
      logger.info("released the seat of a player who left voice", {
        seat: freed.seat,
      });
      active.emulator.clearPlayerInput(freed.seat);
      active.nameOverlay?.setName(freed.seat, null);
      const lost: SeatResponse = { kind: "seat", value: { seat: null } };
      const holder = io.sockets.sockets.get(freed.socketId);
      holder?.emit("response", lost);
      if (holder !== undefined) {
        holder.emit(
          "response",
          statusFor(holder, access, driverFeed !== undefined),
        );
      }
      io.emit("response", seatsResponse(active.seatManager));
    });

    socket.events.subscribe((event) => {
      const active = driver.getActiveRuntime();
      if (active !== null) {
        const store = active.leaderboardStore;
        // Wire the broadcast hook into the active runtime so RaceTracker can
        // push fresh standings through the socket.
        active.setBroadcast(async () => {
          try {
            const [entries, races] = await Promise.all([
              store.leaderboard(),
              store.recentRaces(),
            ]);
            const leaderboard: LeaderboardResponse = {
              kind: "leaderboard",
              value: { entries },
            };
            const recent: RecentRacesResponse = {
              kind: "recent-races",
              value: { races },
            };
            io.emit("response", leaderboard);
            io.emit("response", recent);
          } catch (error) {
            logger.warn("leaderboard broadcast failed", error);
          }
        });
      }
      const overlay = active?.nameOverlay;
      const overlayContext = active?.overlayContext;
      handleRequest(event, {
        seatManager: active?.seatManager ?? NULL_SEAT_MANAGER,
        emulator: active?.emulator,
        driverFeedEnabled: driverFeed !== undefined,
        access,
        stats: statsSource,
        ...(overlay === undefined
          ? {}
          : {
              setOverlayName: (seat: number, name: string | null) => {
                overlay.setName(seat, name);
              },
            }),
        ...(overlayContext === undefined ? {} : { overlayContext }),
      });
    });
  }
}
