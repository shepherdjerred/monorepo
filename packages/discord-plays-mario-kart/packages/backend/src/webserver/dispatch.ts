// Request dispatch: the single place that turns a validated client Request into
// an action (seat claim/release, controller input, screenshot, …). Extracted
// from index.ts so the exact wiring users hit can be exercised in tests without
// booting the emulator or the Discord/stream side.
import { match } from "ts-pattern";
import type { Socket } from "socket.io";
import { encodeScreenshotPng } from "#src/emulator/screenshot.ts";
import type { SeatManager } from "#src/input/seat-manager.ts";
import type { LeaderboardStore } from "#src/leaderboard/store.ts";
import { logger } from "#src/logger.ts";
import {
  controllerRttMs,
  driverFeedClientDecoderResetsTotal,
  driverFeedGlassMs,
} from "#src/observability/metrics.ts";
import { applyStreamOverlays } from "#src/overlay/composite.ts";
import type { StreamOverlayContextProvider } from "#src/overlay/composite.ts";
import type {
  PlayBlocker,
  PlayerInputState,
  PlayerStatsResponse,
  RecentRacesResponse,
  Request,
  Status,
  StatusResponse,
  ScreenshotResponse,
  SeatDeniedResponse,
  SeatResponse,
  SeatsResponse,
  LeaderboardResponse,
} from "@discord-plays-mario-kart/common";
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";

/** The subset of the engine the request dispatch needs (lets tests inject a
 *  fake without booting the game). */
export type EmulatorControls = {
  setPlayerInput: (seat: number, state: PlayerInputState) => void;
  clearPlayerInput: (seat: number) => void;
  renderFrame: () => Promise<{ rgba: Buffer; width: number; height: number }>;
};

/**
 * Who may play. Production derives it from the Discord sign-in on the socket
 * and the bot's view of the session's voice channel; the local harnesses
 * inject a fixed signed-in, in-voice user.
 */
export type PlayAccess = {
  /** The Discord user signed in on this connection, if any. */
  identityOf: (socket: Socket) => DiscordUser | undefined;
  /** Why this user cannot take a seat now, or null when they can. */
  blockerFor: (user: DiscordUser | undefined) => PlayBlocker | null;
  /** The running session's voice channel, or null with no game running. */
  voiceChannel: () => Status["voiceChannel"];
  /** The user as their seat should show them (e.g. with their server nickname). */
  seatUserFor: (user: DiscordUser) => DiscordUser;
  /** Called after a user takes a seat, to remember their current name and avatar. */
  onSeated?: (user: DiscordUser) => void;
};

/** The guild's race history; resolves undefined when there is none to show. */
export type StatsSource = () => Promise<LeaderboardStore | undefined>;

export type DispatchDeps = {
  seatManager: SeatManager;
  emulator: EmulatorControls | undefined;
  driverFeedEnabled: boolean;
  access: PlayAccess;
  stats: StatsSource;
  /** Push the seat's name into the stream overlay (or clear with null). */
  setOverlayName?: (seat: number, name: string | null) => void;
  /** Per-screenshot overlay state. Absent → screenshots stay clean (kept for
   *  test ergonomics and for builds with the stream/overlay disabled). */
  overlayContext?: StreamOverlayContextProvider;
};

export function seatsResponse(seatManager: SeatManager): SeatsResponse {
  return { kind: "seats", value: { seats: seatManager.users() } };
}

export function broadcastSeats(sock: Socket, seatManager: SeatManager): void {
  sock.nsp.emit("response", seatsResponse(seatManager));
}

export function statusFor(
  sock: Socket,
  access: PlayAccess,
  driverFeedEnabled: boolean,
): StatusResponse {
  return {
    kind: "status",
    value: {
      driverFeedEnabled,
      voiceChannel: access.voiceChannel(),
      playBlocker: access.blockerFor(access.identityOf(sock)),
    },
  };
}

/** Run one stats query and emit its response to a single socket (fire-and-forget). */
async function emitStats(
  sock: Socket,
  stats: StatsSource,
  query: (
    store: LeaderboardStore,
  ) => Promise<LeaderboardResponse | PlayerStatsResponse | RecentRacesResponse>,
): Promise<void> {
  try {
    const store = await stats();
    if (store === undefined) return;
    sock.emit("response", await query(store));
  } catch (error) {
    logger.warn("stats query failed", error);
  }
}

function deny(
  sock: Socket,
  reason: SeatDeniedResponse["value"]["reason"],
): void {
  const response: SeatDeniedResponse = {
    kind: "seat-denied",
    value: { reason },
  };
  sock.emit("response", response);
}

// At most one screenshot render in flight per socket. `screenshot` is a public,
// unauthenticated Socket.IO request that waits for the next frame (a 640×480
// RGBA copy + synchronous PNG encode) and returns immediately, so without a
// bound a client can enqueue unbounded renderFrame requests and exhaust
// memory. Duplicates while a render is pending for the same socket are dropped
// (coalesced).
const screenshotInFlight = new Set<string>();

/** Capture the next frame, overlay it, and emit the
 *  PNG to a single socket (fire-and-forget). */
async function emitScreenshot(
  sock: Socket,
  emulator: EmulatorControls,
  overlayContext: StreamOverlayContextProvider | undefined,
): Promise<void> {
  if (screenshotInFlight.has(sock.id)) return; // coalesce spam from one socket
  screenshotInFlight.add(sock.id);
  try {
    const frame = await emulator.renderFrame();
    if (frame.height === 0) return;
    const ctx = overlayContext?.();
    if (ctx !== undefined) {
      applyStreamOverlays(frame.rgba, frame, ctx);
    }
    const png = encodeScreenshotPng(frame);
    const response: ScreenshotResponse = {
      kind: "screenshot",
      value: png.toString("base64"),
    };
    sock.emit("response", response);
  } catch (error) {
    logger.warn("screenshot render failed", error);
  } finally {
    screenshotInFlight.delete(sock.id);
  }
}

export function handleRequest(
  event: { request: Request; socket: Socket },
  deps: DispatchDeps,
): void {
  const sock = event.socket;
  const {
    seatManager,
    emulator,
    driverFeedEnabled,
    access,
    stats,
    setOverlayName,
    overlayContext,
  } = deps;
  match(event)
    .with({ request: { kind: "seat-claim" } }, (e) => {
      const user = access.identityOf(sock);
      const blocker = access.blockerFor(user);
      if (user === undefined || blocker !== null) {
        deny(sock, blocker ?? "signed-out");
        return;
      }
      const seatUser = access.seatUserFor(user);
      const claim = seatManager.claim(sock.id, seatUser, e.request.seat);
      if (claim.kind === "taken") {
        deny(sock, "taken");
        return;
      }
      // The same account's other tab loses the seat to this one.
      if (claim.displacedSocketId !== undefined) {
        const moved: SeatResponse = { kind: "seat", value: { seat: null } };
        sock.nsp.sockets.get(claim.displacedSocketId)?.emit("response", moved);
        emulator?.clearPlayerInput(claim.vacatedSeat ?? claim.seat);
        if (claim.vacatedSeat !== undefined)
          setOverlayName?.(claim.vacatedSeat, null);
      }
      setOverlayName?.(claim.seat, seatUser.name);
      access.onSeated?.(seatUser);
      const response: SeatResponse = {
        kind: "seat",
        value: { seat: claim.seat },
      };
      sock.emit("response", response);
      // Free the seat (and clear held input + overlay name) when this socket
      // leaves, unless it has already lost it.
      sock.once("disconnect", () => {
        const freed = seatManager.release(sock.id);
        if (freed !== null) {
          emulator?.clearPlayerInput(freed);
          setOverlayName?.(freed, null);
          broadcastSeats(sock, seatManager);
        }
      });
      broadcastSeats(sock, seatManager);
    })
    .with({ request: { kind: "seat-release" } }, () => {
      const freed = seatManager.release(sock.id);
      if (freed !== null) {
        emulator?.clearPlayerInput(freed);
        setOverlayName?.(freed, null);
      }
      const response: SeatResponse = { kind: "seat", value: { seat: null } };
      sock.emit("response", response);
      broadcastSeats(sock, seatManager);
    })
    .with({ request: { kind: "input" } }, (e) => {
      if (emulator === undefined) return;
      if (!seatManager.owns(sock.id, e.request.seat)) return; // not your seat
      emulator.setPlayerInput(e.request.seat, e.request.state);
    })
    .with({ request: { kind: "latency-report" } }, (e) => {
      controllerRttMs.observe({ runtime: "mk64" }, e.request.rttMs);
      for (const glassMs of e.request.glassMs ?? []) {
        driverFeedGlassMs.observe(glassMs);
      }
      if (e.request.decoderResets !== undefined) {
        driverFeedClientDecoderResetsTotal.inc(e.request.decoderResets);
      }
    })
    .with({ request: { kind: "leaderboard" } }, () => {
      void emitStats(sock, stats, async (store) => ({
        kind: "leaderboard",
        value: { entries: await store.leaderboard() },
      }));
    })
    .with({ request: { kind: "player-stats" } }, (e) => {
      const { discordId } = e.request;
      void emitStats(sock, stats, async (store) => ({
        kind: "player-stats",
        value: { discordId, stats: await store.playerStats(discordId) },
      }));
    })
    .with({ request: { kind: "recent-races" } }, () => {
      void emitStats(sock, stats, async (store) => ({
        kind: "recent-races",
        value: { races: await store.recentRaces() },
      }));
    })
    .with({ request: { kind: "screenshot" } }, (e) => {
      if (emulator === undefined) return;
      void emitScreenshot(e.socket, emulator, overlayContext);
    })
    .with({ request: { kind: "status" } }, (e) => {
      e.socket.emit("response", statusFor(e.socket, access, driverFeedEnabled));
      e.socket.emit("response", seatsResponse(seatManager));
    })
    .exhaustive();
}
