import type { Request, Response } from "@discord-plays-mario-kart/common";
import { socket } from "#src/socket.ts";

/**
 * The socket has no reply timeout of its own, so a request sent while the
 * connection is down never settles. Rejecting after a bound gives the request
 * an actual failure, which is what lets the UI say so and offer a retry.
 */
const RESPONSE_TIMEOUT_MS = 10_000;

/**
 * Send one request and resolve with the first response `pick` accepts. Requests
 * and responses are not correlated on the wire, so `pick` must match only the
 * reply this request asked for (for example by kind and id).
 */
export function socketRequest<T>(
  request: Request,
  pick: (response: Response) => T | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const settle = (finish: () => void) => {
      socket.off("response", onResponse);
      clearTimeout(timer);
      finish();
    };
    const onResponse = (response: Response) => {
      const value = pick(response);
      if (value === undefined) {
        return;
      }
      settle(() => {
        resolve(value);
      });
    };
    const timer = setTimeout(() => {
      settle(() => {
        reject(new Error("The game server did not answer in time."));
      });
    }, RESPONSE_TIMEOUT_MS);

    socket.on("response", onResponse);
    socket.emit("request", request);
  });
}
