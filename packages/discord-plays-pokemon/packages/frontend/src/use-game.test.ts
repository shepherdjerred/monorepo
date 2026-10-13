import { expect, test, vi } from "vitest";
import { EMPTY_GAME } from "./game.ts";
import { listenToGame } from "./use-game.ts";

const connection = vi.hoisted(() => ({
  connected: true,
  on: vi.fn<(event: string, listener: (raw: unknown) => void) => void>(),
  off: vi.fn<(event: string, listener: (raw: unknown) => void) => void>(),
  emit: vi.fn<(event: string, request: unknown) => void>(),
}));
vi.mock("./socket.ts", () => ({ socket: connection }));

test("a socket connected before listeners attach requests the complete snapshot", () => {
  vi.useFakeTimers();
  let game = EMPTY_GAME;
  const stop = listenToGame((update) => {
    game = typeof update === "function" ? update(game) : update;
  });
  try {
    expect(game.connected).toBe(true);
    expect(connection.on.mock.calls.map(([event]) => event)).toEqual([
      "connect",
      "disconnect",
      "response",
    ]);
    expect(connection.emit).toHaveBeenCalledWith("request", {
      kind: "snapshot",
    });
    vi.advanceTimersByTime(3000);
    expect(connection.emit).toHaveBeenLastCalledWith("request", {
      kind: "status",
    });
  } finally {
    stop();
    expect(connection.off).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  }
});
