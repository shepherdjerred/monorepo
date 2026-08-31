import { CustomSnapshotEnvelopeSchema } from "@scout-for-lol/data";
import type { CustomActivityClaims } from "@scout-for-lol/data";
import {
  assertCustomActivityPolicy,
  isAllowedCustomActivityOrigin,
  verifyCustomActivityTokenWithExpiry,
} from "#src/customs/activity-auth.ts";
import { customActivityActor } from "#src/customs/activity-actor.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("customs-socket");
export const CUSTOMS_SOCKET_PATH = "/api/customs/socket";

export type CustomSocketData = {
  readonly claims: CustomActivityClaims;
  readonly expiresAtMs: number;
};

const socketsByGuild = new Map<
  string,
  Set<Bun.ServerWebSocket<CustomSocketData>>
>();
const deliveryQueues = new WeakMap<
  Bun.ServerWebSocket<CustomSocketData>,
  Promise<void>
>();
const expiryTimers = new WeakMap<
  Bun.ServerWebSocket<CustomSocketData>,
  ReturnType<typeof setTimeout>
>();

function tokenFromProtocols(request: Request): string | undefined {
  const protocols = request.headers
    .get("Sec-WebSocket-Protocol")
    ?.split(",")
    .map((protocol) => protocol.trim());
  return protocols?.[0] === "scout-customs" ? protocols[1] : undefined;
}

function removeSocket(socket: Bun.ServerWebSocket<CustomSocketData>): void {
  const timer = expiryTimers.get(socket);
  if (timer !== undefined) clearTimeout(timer);
  expiryTimers.delete(socket);
  deliveryQueues.delete(socket);
  const guildSockets = socketsByGuild.get(socket.data.claims.guildId);
  guildSockets?.delete(socket);
  if (guildSockets?.size === 0)
    socketsByGuild.delete(socket.data.claims.guildId);
}

async function activeNightId(guildId: string): Promise<string | undefined> {
  const pointer = await prisma.customActiveNight.findUnique({
    where: { guildId },
    select: { nightId: true },
  });
  return pointer?.nightId;
}

async function sendCurrentSnapshot(
  socket: Bun.ServerWebSocket<CustomSocketData>,
  requestedNightId?: string,
): Promise<void> {
  await assertCustomActivityPolicy(socket.data.claims);
  const nightId =
    requestedNightId ?? (await activeNightId(socket.data.claims.guildId));
  const actor = await customActivityActor(socket.data.claims);
  const snapshot =
    nightId === undefined
      ? undefined
      : await buildCustomNightSnapshot(prisma, nightId, actor.discordId, {
          viewerAdministrator: actor.administrator,
        });
  if (
    snapshot !== undefined &&
    snapshot.guildId !== socket.data.claims.guildId
  ) {
    throw new Error("Custom snapshot guild does not match socket claims");
  }
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(
    JSON.stringify(
      CustomSnapshotEnvelopeSchema.parse({
        kind: "snapshot",
        sequence: snapshot?.revision ?? 0,
        snapshot: snapshot ?? null,
      }),
    ),
  );
}

function enqueueSnapshot(
  socket: Bun.ServerWebSocket<CustomSocketData>,
  nightId?: string,
): void {
  const previous = deliveryQueues.get(socket) ?? Promise.resolve();
  const delivery = deliverSnapshot(socket, nightId, previous);
  deliveryQueues.set(socket, delivery);
}

async function deliverSnapshot(
  socket: Bun.ServerWebSocket<CustomSocketData>,
  nightId: string | undefined,
  previous: Promise<void>,
): Promise<void> {
  try {
    await previous;
    await sendCurrentSnapshot(socket, nightId);
  } catch (error) {
    logger.warn("Closing Customs socket after delivery authorization failed", {
      error,
      guildId: socket.data.claims.guildId,
    });
    removeSocket(socket);
    socket.close(1008, "Customs authorization changed");
  }
}

export async function upgradeCustomSocket(
  request: Request,
  server: Bun.Server<CustomSocketData>,
): Promise<Response | undefined> {
  if (!isAllowedCustomActivityOrigin(request.headers.get("Origin"))) {
    return new Response("Forbidden Activity origin", { status: 403 });
  }
  const token = tokenFromProtocols(request);
  if (token === undefined) {
    return new Response("Missing Activity session", { status: 401 });
  }
  const session = await verifyCustomActivityTokenWithExpiry(token);
  if (session === null) {
    return new Response("Invalid Activity session", { status: 401 });
  }
  await assertCustomActivityPolicy(session.claims);
  const upgraded = server.upgrade(request, {
    data: { claims: session.claims, expiresAtMs: session.expiresAtMs },
    headers: { "Sec-WebSocket-Protocol": "scout-customs" },
  });
  return upgraded
    ? undefined
    : new Response("WebSocket upgrade failed", { status: 400 });
}

export const customSocketHandlers: Bun.WebSocketHandler<CustomSocketData> = {
  open(socket) {
    const expiresInMs = socket.data.expiresAtMs - Date.now();
    if (expiresInMs <= 0) {
      socket.close(1008, "Activity session expired");
      return;
    }
    const guildSockets =
      socketsByGuild.get(socket.data.claims.guildId) ?? new Set();
    guildSockets.add(socket);
    socketsByGuild.set(socket.data.claims.guildId, guildSockets);
    expiryTimers.set(
      socket,
      setTimeout(() => {
        socket.close(1008, "Activity session expired");
      }, expiresInMs),
    );
    enqueueSnapshot(socket);
  },
  close(socket) {
    removeSocket(socket);
  },
  message(socket) {
    socket.close(1008, "Client messages unsupported");
  },
};

/** Rebuilds and queues an individualized, code-redacted snapshot per socket. */
export async function publishCustomNightSnapshot(
  nightId: string,
): Promise<void> {
  const night = await prisma.customNight.findUniqueOrThrow({
    where: { id: nightId },
    select: { guildId: true },
  });
  for (const socket of socketsByGuild.get(night.guildId) ?? []) {
    enqueueSnapshot(socket, nightId);
  }
}
