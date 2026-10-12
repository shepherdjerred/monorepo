import {
  ResponseSchema,
  type Request,
  type Response,
} from "@discord-plays-mario-kart/common";
import { socketRequest as sendRequest } from "@shepherdjerred/discord-plays-web/socket/socket-request.ts";
import { socket } from "#src/socket.ts";

/** One request to the game server, resolved by the reply `pick` accepts. */
export function socketRequest<T>(
  request: Request,
  pick: (response: Response) => T | undefined,
): Promise<T> {
  return sendRequest(socket, request, ResponseSchema, pick);
}
