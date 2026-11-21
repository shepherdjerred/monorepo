import {
  RoomSchema,
  type WebRoom,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";

/** Reads `GET /api/room` as the signed-in viewer, the way the remote does. */
export function roomReader(
  handler: (request: Request) => Promise<Response>,
  url: string,
  cookie: string,
): () => Promise<WebRoom> {
  return async () => {
    const response = await handler(new Request(url, { headers: { cookie } }));
    if (response.status !== 200)
      throw new Error("GET /api/room answered " + String(response.status));
    return RoomSchema.parse(await response.json());
  };
}

/** One player of the viewer's room: the given slot, or the first player when no slot is named. */
export async function roomPlayer(
  fixture: { room: () => Promise<WebRoom> },
  slot?: number,
): Promise<WebRoom["players"][number] | undefined> {
  const { players } = await fixture.room();
  return slot === undefined
    ? players[0]
    : players.find((player) => player.slot === slot);
}

/** Runs the Discord OAuth start and callback round trip against a fixture handler. */
export async function discordLogin(
  handler: (request: Request) => Promise<Response>,
  origin = "http://127.0.0.1:8080",
): Promise<Response> {
  const start = await handler(new Request(origin + "/api/auth/discord/start"));
  const state = new URL(start.headers.get("location") ?? "").searchParams.get(
    "state",
  );
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return await handler(
    new Request(
      origin + "/api/auth/discord/callback?code=fixture&state=" + String(state),
      { headers: { cookie } },
    ),
  );
}
