import {
  SCOUT_CLIENT_MAX_BATCH_BYTES,
  ScoutClientCheckInSchema,
  ScoutClientCheckInResponseSchema,
  ScoutClientCreatePairingSchema,
  ScoutClientObservationBatchSchema,
  ScoutClientPairingExchangeSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import {
  authenticateScoutClient,
  type AuthenticatedScoutClient,
} from "./authentication.ts";
import {
  createPairing,
  exchangePairing,
  revokeDevice,
  type PairingInput,
} from "./pairing.ts";
import { pairingCreationAllowed } from "./pairing-rate-limit.ts";
import {
  ingestObservationBatch,
  nextScoutClientObservationSequence,
  ScoutClientObservationConflict,
  startAcceptedClientMatches,
} from "./ingress.ts";
import { ReplayUploadError, uploadReplay } from "./replay-upload.ts";

const API_PREFIX = "/api/scout-client/v1";
const EXCHANGE_PATH =
  /^\/api\/scout-client\/v1\/pairings\/([0-9a-f-]{36})\/exchange$/;
const REPLAY_PATH = /^\/api\/scout-client\/v1\/replays\/(\d{1,32})$/;
const SELF_REVOKE_PATH = `${API_PREFIX}/devices/current/revoke`;
const BodyChunkSchema = z.instanceof(Uint8Array);

class ScoutClientRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function boundedJson(request: Request): Promise<unknown> {
  if (
    request.headers.get("Content-Type")?.startsWith("application/json") !== true
  ) {
    throw new ScoutClientRequestError(
      "Content-Type must be application/json",
      415,
    );
  }
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > SCOUT_CLIENT_MAX_BATCH_BYTES) {
    throw new ScoutClientRequestError("Request body is too large", 413);
  }
  if (request.body === null) {
    throw new ScoutClientRequestError("Request body is not valid JSON", 400);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let result = await reader.read();
  while (!result.done) {
    const chunk = BodyChunkSchema.safeParse(result.value);
    if (!chunk.success) {
      await reader.cancel();
      throw new ScoutClientRequestError("Request body is not valid JSON", 400);
    }
    totalBytes += chunk.data.byteLength;
    if (totalBytes > SCOUT_CLIENT_MAX_BATCH_BYTES) {
      await reader.cancel();
      throw new ScoutClientRequestError("Request body is too large", 413);
    }
    chunks.push(chunk.data);
    result = await reader.read();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ScoutClientRequestError("Request body is not valid JSON", 400);
  }
}

async function handlePairingRoute(
  request: Request,
  pathname: string,
): Promise<Response | null> {
  if (pathname === `${API_PREFIX}/pairings`) {
    if (!pairingCreationAllowed(request)) {
      const response = jsonResponse({ error: "rate_limited" }, 429);
      response.headers.set("Retry-After", "60");
      return response;
    }
    const input = ScoutClientCreatePairingSchema.safeParse(
      await boundedJson(request),
    );
    return input.success
      ? jsonResponse(
          await createPairing(input.data satisfies PairingInput),
          201,
        )
      : jsonResponse({ error: "invalid_request" }, 400);
  }

  const exchangeMatch = EXCHANGE_PATH.exec(pathname);
  if (exchangeMatch === null) return null;
  const pairingId = exchangeMatch[1];
  if (pairingId === undefined) return jsonResponse({ error: "not_found" }, 404);
  const input = ScoutClientPairingExchangeSchema.safeParse(
    await boundedJson(request),
  );
  if (!input.success) return jsonResponse({ error: "invalid_request" }, 400);
  const result = await exchangePairing(pairingId, input.data.pairingSecret);
  if (result === null) return jsonResponse({ error: "not_found" }, 404);
  return jsonResponse(result, result.status === "consumed" ? 409 : 200);
}

async function handleAuthenticatedRoute(
  request: Request,
  pathname: string,
  replayMatch: RegExpExecArray | null,
  device: AuthenticatedScoutClient,
): Promise<Response> {
  if (replayMatch !== null) {
    const gameId = replayMatch[1];
    if (gameId === undefined) return jsonResponse({ error: "not_found" }, 404);
    const replay = await uploadReplay(request, gameId, device);
    return jsonResponse(replay, replay.outcome === "accepted" ? 201 : 200);
  }

  if (pathname === `${API_PREFIX}/check-ins`) {
    const input = ScoutClientCheckInSchema.safeParse(
      await boundedJson(request),
    );
    if (!input.success) return jsonResponse({ error: "invalid_request" }, 400);
    const checkedInAt = new Date();
    const checkIn = await prisma.$transaction([
      prisma.scoutClientDevice.update({
        where: { id: device.deviceId },
        data: { appVersion: input.data.appVersion, lastSeenAt: checkedInAt },
      }),
      prisma.scoutClientDeviceVersion.upsert({
        where: {
          deviceId_appVersion: {
            deviceId: device.deviceId,
            appVersion: input.data.appVersion,
          },
        },
        create: {
          deviceId: device.deviceId,
          appVersion: input.data.appVersion,
          lastSeenAt: checkedInAt,
        },
        update: { lastSeenAt: checkedInAt },
      }),
      prisma.scoutClientObservation.aggregate({
        where: { deviceId: device.deviceId },
        _max: { sequence: true },
      }),
    ]);
    const sequence = checkIn[2];
    return jsonResponse(
      ScoutClientCheckInResponseSchema.parse({
        accepted: true,
        nextSequence: nextScoutClientObservationSequence(
          sequence._max.sequence,
        ),
      }),
    );
  }

  if (pathname === SELF_REVOKE_PATH) {
    await revokeDevice(device.deviceId, device.ownerId);
    return jsonResponse({ revoked: true });
  }

  if (pathname === `${API_PREFIX}/observations/batch`) {
    const input = ScoutClientObservationBatchSchema.safeParse(
      await boundedJson(request),
    );
    if (!input.success) return jsonResponse({ error: "invalid_request" }, 400);
    const receipts = await ingestObservationBatch(device, input.data);
    await startAcceptedClientMatches(input.data, receipts);
    return jsonResponse({ receipts, serverTime: new Date().toISOString() });
  }
  return jsonResponse({ error: "not_found" }, 404);
}

function requestMethodAllowed(
  method: string,
  replayMatch: RegExpExecArray | null,
): boolean {
  return method === "POST" || (method === "PUT" && replayMatch !== null);
}

export async function handleScoutClientRoute(
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (!url.pathname.startsWith(API_PREFIX)) return null;
  const replayMatch = REPLAY_PATH.exec(url.pathname);
  if (!requestMethodAllowed(request.method, replayMatch)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST, PUT" },
    });
  }
  try {
    const pairingResponse = await handlePairingRoute(request, url.pathname);
    if (pairingResponse !== null) return pairingResponse;

    const device = await authenticateScoutClient(
      request,
      url.pathname !== SELF_REVOKE_PATH,
    );
    return device === null
      ? jsonResponse({ error: "unauthorized" }, 401)
      : await handleAuthenticatedRoute(
          request,
          url.pathname,
          replayMatch,
          device,
        );
  } catch (error) {
    if (error instanceof ScoutClientRequestError) {
      return new Response(error.message, { status: error.status });
    }
    if (error instanceof ScoutClientObservationConflict) {
      return jsonResponse({ error: "observation_conflict" }, 409);
    }
    if (error instanceof ReplayUploadError) {
      return jsonResponse(
        { error: "replay_rejected", message: error.message },
        error.status,
      );
    }
    throw error;
  }
}
