import type {
  CustomActivityClaims,
  CustomNightSnapshot,
} from "@scout-for-lol/data";
import { CustomSnapshotEnvelopeSchema } from "@scout-for-lol/data";
import { TRPCError } from "@trpc/server";
import { verifyCustomActivityTokenWithExpiry } from "#src/customs/activity-auth.ts";
import { assertCustomGuildMember } from "#src/customs/discord-client.ts";
import { getActiveCustomNight } from "#src/customs/repository.ts";
import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("customs-socket");

type CustomSocketData = {
  claims: CustomActivityClaims;
  expiresAtMs: number;
};

const socketsByGuild = new Map<
  string,
  Set<Bun.ServerWebSocket<CustomSocketData>>
>();
const expiryTimers = new WeakMap<
  Bun.ServerWebSocket<CustomSocketData>,
  ReturnType<typeof globalThis.setTimeout>
>();
const snapshotDeliveryQueues = new WeakMap<
  Bun.ServerWebSocket<CustomSocketData>,
  Promise<void>
>();

function isAllowedActivityOrigin(
  origin: string | null,
  configuredOrigin: string,
): boolean {
  if (origin === configuredOrigin) return true;
  if (origin === null) return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".discordsays.com")
    );
  } catch {
    return false;
  }
}

function removeCustomSocket(
  socket: Bun.ServerWebSocket<CustomSocketData>,
): void {
  const expiryTimer = expiryTimers.get(socket);
  if (expiryTimer !== undefined) globalThis.clearTimeout(expiryTimer);
  expiryTimers.delete(socket);
  const guildId = socket.data.claims.guildId;
  const guildSockets = socketsByGuild.get(guildId);
  guildSockets?.delete(socket);
  if (guildSockets?.size === 0) socketsByGuild.delete(guildId);
  snapshotDeliveryQueues.delete(socket);
}

function activityTokenFromProtocols(request: Request): string | null {
  const protocols = request.headers
    .get("Sec-WebSocket-Protocol")
    ?.split(",")
    .map((value) => value.trim());
  if (protocols?.[0] !== "scout-customs") return null;
  return protocols[1] ?? null;
}

function isDefinitiveMembershipFailure(error: unknown): boolean {
  return error instanceof TRPCError && error.code === "FORBIDDEN";
}

export async function upgradeCustomSocket(
  request: Request,
  server: Bun.Server<CustomSocketData>,
): Promise<Response | undefined> {
  const activityOrigin = configuration.customs?.activityOrigin;
  if (activityOrigin === undefined)
    return new Response("Scout Customs is unavailable", { status: 503 });
  if (!isAllowedActivityOrigin(request.headers.get("Origin"), activityOrigin))
    return new Response("Forbidden Activity origin", { status: 403 });
  const token = activityTokenFromProtocols(request);
  if (token === null)
    return new Response("Missing Activity session", { status: 401 });
  const session = await verifyCustomActivityTokenWithExpiry(token);
  if (session === null)
    return new Response("Invalid Activity session", { status: 401 });
  const upgraded = server.upgrade(request, {
    data: session,
    headers: { "Sec-WebSocket-Protocol": "scout-customs" },
  });
  if (!upgraded)
    return new Response("WebSocket upgrade failed", { status: 400 });
  return undefined;
}

export const customSocketHandlers: Bun.WebSocketHandler<CustomSocketData> = {
  async open(socket) {
    const guildId = socket.data.claims.guildId;
    const expiresInMs = socket.data.expiresAtMs - Date.now();
    if (expiresInMs <= 0) {
      socket.close(1008, "Activity session expired");
      return;
    }
    try {
      await assertCustomGuildMember(socket.data.claims);
    } catch (error) {
      if (!isDefinitiveMembershipFailure(error)) {
        logger.error("Customs socket membership check failed", {
          error,
          guildId,
        });
        socket.close(1011, "Customs membership check failed");
        return;
      }
      logger.info("Customs socket rejected for missing guild membership", {
        error,
        guildId,
      });
      socket.close(1008, "Activity guild membership required");
      return;
    }
    expiryTimers.set(
      socket,
      globalThis.setTimeout(() => {
        socket.close(1008, "Activity session expired");
      }, expiresInMs),
    );
    const guildSockets = socketsByGuild.get(guildId) ?? new Set();
    guildSockets.add(socket);
    socketsByGuild.set(guildId, guildSockets);
    try {
      const snapshot = await getActiveCustomNight(prisma, guildId);
      enqueueSnapshotDelivery(
        socket,
        JSON.stringify(
          CustomSnapshotEnvelopeSchema.parse({ kind: "snapshot", snapshot }),
        ),
      );
    } catch (error) {
      removeCustomSocket(socket);
      logger.error("Customs socket initialization failed", { error, guildId });
      socket.close(1011, "Customs snapshot initialization failed");
    }
  },
  close(socket) {
    removeCustomSocket(socket);
  },
  message(socket) {
    // Commands travel through authenticated tRPC. The socket is deliberately
    // server-to-client only so one protocol cannot become a second mutation authority.
    socket.close(1008, "Client messages unsupported");
  },
};

export function publishCustomSnapshot(snapshot: CustomNightSnapshot): void {
  const envelope = JSON.stringify(
    CustomSnapshotEnvelopeSchema.parse({ kind: "snapshot", snapshot }),
  );
  for (const socket of socketsByGuild.get(snapshot.guildId) ?? []) {
    enqueueSnapshotDelivery(socket, envelope);
  }
}

function enqueueSnapshotDelivery(
  socket: Bun.ServerWebSocket<CustomSocketData>,
  envelope: string,
): void {
  const previous = snapshotDeliveryQueues.get(socket) ?? Promise.resolve();
  const delivery = deliverSnapshotAfter(previous, socket, envelope);
  snapshotDeliveryQueues.set(socket, delivery);
}

async function deliverSnapshotAfter(
  previous: Promise<void>,
  socket: Bun.ServerWebSocket<CustomSocketData>,
  envelope: string,
): Promise<void> {
  try {
    await previous;
  } catch (error) {
    logger.error("Customs socket snapshot delivery failed", { error });
  }
  try {
    await sendSnapshotToAuthorizedSocket(socket, envelope);
  } catch (error) {
    logger.error("Customs socket snapshot delivery failed", { error });
  }
}

async function sendSnapshotToAuthorizedSocket(
  socket: Bun.ServerWebSocket<CustomSocketData>,
  envelope: string,
): Promise<void> {
  try {
    await assertCustomGuildMember(socket.data.claims);
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(envelope);
  } catch (error) {
    if (isDefinitiveMembershipFailure(error)) {
      logger.info("Closing Customs socket after guild membership loss", {
        error,
        guildId: socket.data.claims.guildId,
      });
      removeCustomSocket(socket);
      socket.close(1008, "Activity guild membership required");
      return;
    }
    logger.error("Customs socket membership check failed", {
      error,
      guildId: socket.data.claims.guildId,
    });
    removeCustomSocket(socket);
    socket.close(1011, "Customs membership check failed");
  }
}
