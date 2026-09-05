import type {
  LeaderboardEntry,
  Response,
} from "@discord-plays-mario-kart/common";
import { socket } from "./socket.ts";

export const LEADERBOARD_QUERY_KEY = ["leaderboard"] as const;

/**
 * The socket has no reply timeout of its own, so a request sent while the
 * connection is down never settles. The component used to model that with a
 * single `loaded` boolean, which meant a dropped socket rendered "Loading…"
 * forever with no way to tell the difference from a slow server.
 *
 * Rejecting after a bound gives the request an actual failure, which is what
 * lets the UI say so and offer a retry.
 */
const RESPONSE_TIMEOUT_MS = 10_000;

export function requestLeaderboard(): Promise<LeaderboardEntry[]> {
  return new Promise<LeaderboardEntry[]>((resolve, reject) => {
    const settle = (finish: () => void) => {
      socket.off("response", onResponse);
      clearTimeout(timer);
      finish();
    };
    const onResponse = (response: Response) => {
      if (response.kind !== "leaderboard") return;
      settle(() => {
        resolve(response.value.entries);
      });
    };
    const timer = setTimeout(() => {
      settle(() => {
        reject(new Error("The leaderboard request timed out."));
      });
    }, RESPONSE_TIMEOUT_MS);

    socket.on("response", onResponse);
    socket.emit("request", { kind: "leaderboard" });
  });
}
