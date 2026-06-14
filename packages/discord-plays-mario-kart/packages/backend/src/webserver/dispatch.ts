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
import { controllerRttMs } from "#src/observability/metrics.ts";
import { applyStreamOverlays } from "#src/overlay/composite.ts";
import type { StreamOverlayContext } from "#src/overlay/composite.ts";
import type {
  PlayerInputState,
  Request,
  LoginResponse,
  StatusResponse,
  ScreenshotResponse,
  SeatResponse,
  SeatsResponse,
  LeaderboardResponse,
} from "@discord-plays-mario-kart/common";

/** The subset of the emulator the request dispatch needs (lets tests inject a
 *  fake without booting wasm). */
export type EmulatorControls = {
  setPlayerInput: (seat: number, state: PlayerInputState) => void;
  clearPlayerInput: (seat: number) => void;
  renderFrame: () => { rgba: Buffer; width: number; height: number };
};

/** Optional leaderboard wiring; absent when the feature is disabled. */
export type LeaderboardDeps = {
  store: LeaderboardStore;
  /** Push the seat's name into the stream overlay (or clear with null). */
  setOverlayName?: (seat: number, name: string | null) => void;
};

/** Resolves the live overlay context at screenshot time, so each call reads
 *  the current mode + seat-activity flags. The provider itself is optional
 *  (absent → screenshots stay clean); when present it always returns a real
 *  context. */
export type StreamOverlayContextProvider = () => StreamOverlayContext;

export type DispatchDeps = {
  seatManager: SeatManager;
  emulator: EmulatorControls | undefined;
  leaderboard?: LeaderboardDeps;
  /** Per-screenshot overlay state. Absent → screenshots stay clean (kept for
   *  test ergonomics and for builds with the stream/overlay disabled). */
  overlayContext?: StreamOverlayContextProvider;
};

export function broadcastSeats(sock: Socket, seatManager: SeatManager): void {
  const response: SeatsResponse = {
    kind: "seats",
    value: { occupied: seatManager.occupied(), names: seatManager.names() },
  };
  sock.nsp.emit("response", response);
}

/** Fetch + emit the leaderboard to a single socket (fire-and-forget). */
async function emitLeaderboard(
  sock: Socket,
  store: LeaderboardStore,
): Promise<void> {
  try {
    const entries = await store.leaderboard();
    const response: LeaderboardResponse = {
      kind: "leaderboard",
      value: { entries },
    };
    sock.emit("response", response);
  } catch (error) {
    logger.warn("leaderboard fetch failed", error);
  }
}

export function handleRequest(
  event: { request: Request; socket: Socket },
  deps: DispatchDeps,
): void {
  const sock = event.socket;
  const { seatManager, emulator, leaderboard, overlayContext } = deps;
  match(event)
    .with({ request: { kind: "seat-claim" } }, (e) => {
      const seat = seatManager.claim(sock.id, e.request.seat);
      const response: SeatResponse = { kind: "seat", value: { seat } };
      sock.emit("response", response);
      if (seat !== null) {
        // Free the seat (and clear held input + overlay name) when this socket
        // leaves.
        sock.once("disconnect", () => {
          const freed = seatManager.release(sock.id);
          if (freed !== null) {
            emulator?.clearPlayerInput(freed);
            leaderboard?.setOverlayName?.(freed, null);
            broadcastSeats(sock, seatManager);
          }
        });
        broadcastSeats(sock, seatManager);
      }
    })
    .with({ request: { kind: "seat-release" } }, () => {
      const freed = seatManager.release(sock.id);
      if (freed !== null) {
        emulator?.clearPlayerInput(freed);
        leaderboard?.setOverlayName?.(freed, null);
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
      controllerRttMs.observe(e.request.rttMs);
    })
    .with({ request: { kind: "login" } }, (e) => {
      // TODO(todo:mario-kart-web-auth): real auth. Identity is cosmetic; seats gate control.
      const player = { discordId: "id", discordUsername: "username" };
      const response: LoginResponse = { kind: "login", value: player };
      e.socket.emit("response", response);
    })
    .with({ request: { kind: "name-set" } }, (e) => {
      // Identity is the socket connection: only the seat this socket owns can
      // be (re)named. Unseated callers are ignored.
      const seat = seatManager.setName(sock.id, e.request.name);
      if (seat === null) return;
      leaderboard?.setOverlayName?.(seat, e.request.name);
      broadcastSeats(sock, seatManager);
    })
    .with({ request: { kind: "leaderboard" } }, () => {
      if (leaderboard === undefined) return;
      void emitLeaderboard(sock, leaderboard.store);
    })
    .with({ request: { kind: "screenshot" } }, (e) => {
      if (emulator === undefined) return;
      const frame = emulator.renderFrame();
      if (frame.height === 0) return;
      const ctx = overlayContext?.();
      if (ctx !== undefined) {
        applyStreamOverlays(frame.rgba, frame.height, ctx);
      }
      const png = encodeScreenshotPng(frame);
      const response: ScreenshotResponse = {
        kind: "screenshot",
        value: png.toString("base64"),
      };
      e.socket.emit("response", response);
    })
    .with({ request: { kind: "status" } }, (e) => {
      const response: StatusResponse = {
        kind: "status",
        value: { playerList: [] },
      };
      e.socket.emit("response", response);
      broadcastSeats(e.socket, seatManager);
    })
    .exhaustive();
}
