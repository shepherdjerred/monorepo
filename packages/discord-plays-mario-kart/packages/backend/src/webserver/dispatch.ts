// Request dispatch: the single place that turns a validated client Request into
// an action (seat claim/release, controller input, screenshot, …). Extracted
// from index.ts so the exact wiring users hit can be exercised in tests without
// booting the emulator or the Discord/stream side.
import { match } from "ts-pattern";
import type { Socket } from "socket.io";
import { encodeScreenshotPng } from "#src/emulator/screenshot.ts";
import type { SeatManager } from "#src/input/seat-manager.ts";
import { controllerRttMs } from "#src/observability/metrics.ts";
import type {
  PlayerInputState,
  Request,
  LoginResponse,
  StatusResponse,
  ScreenshotResponse,
  SeatResponse,
  SeatsResponse,
} from "@discord-plays-mario-kart/common";

/** The subset of the emulator the request dispatch needs (lets tests inject a
 *  fake without booting wasm). */
export type EmulatorControls = {
  setPlayerInput: (seat: number, state: PlayerInputState) => void;
  clearPlayerInput: (seat: number) => void;
  renderFrame: () => { rgba: Buffer; width: number; height: number };
};

export function broadcastSeats(sock: Socket, seatManager: SeatManager): void {
  const response: SeatsResponse = {
    kind: "seats",
    value: { occupied: seatManager.occupied() },
  };
  sock.nsp.emit("response", response);
}

export function handleRequest(
  event: { request: Request; socket: Socket },
  deps: { seatManager: SeatManager; emulator: EmulatorControls | undefined },
): void {
  const sock = event.socket;
  const { seatManager, emulator } = deps;
  match(event)
    .with({ request: { kind: "seat-claim" } }, (e) => {
      const seat = seatManager.claim(sock.id, e.request.seat);
      const response: SeatResponse = { kind: "seat", value: { seat } };
      sock.emit("response", response);
      if (seat !== null) {
        // Free the seat (and clear held input) when this socket leaves.
        sock.once("disconnect", () => {
          const freed = seatManager.release(sock.id);
          if (freed !== null) {
            emulator?.clearPlayerInput(freed);
            broadcastSeats(sock, seatManager);
          }
        });
        broadcastSeats(sock, seatManager);
      }
    })
    .with({ request: { kind: "seat-release" } }, () => {
      const freed = seatManager.release(sock.id);
      if (freed !== null) emulator?.clearPlayerInput(freed);
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
    .with({ request: { kind: "screenshot" } }, (e) => {
      if (emulator === undefined) return;
      const frame = emulator.renderFrame();
      if (frame.height === 0) return;
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
