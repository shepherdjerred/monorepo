import {
  SCOUT_CLIENT_MAX_BATCH_BYTES,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_EVENTS_PATH,
  SCOUT_DESKTOP_PAIRING_V2_SCOPES,
  ScoutClientCheckInSchema,
  ScoutClientCheckInResponseSchema,
  ScoutClientCreatePairingSchema,
  ScoutClientObservationBatchSchema,
  ScoutClientPairingExchangeSchema,
  SCOUT_CLIENT_UPGRADE_REQUIRED_STATUS,
  type ScoutClientUpgradeRequired,
  ScoutDesktopPairingV2ResponseSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
import { clientUpgradeRequired } from "./access/minimum-version.ts";
import { prisma } from "#src/database/index.ts";
import { isScoutClientLive } from "./access/policy.ts";
import {
  authenticateScoutClient,
  type AuthenticatedScoutClient,
} from "./access/authentication.ts";
import {
  createPairing,
  exchangePairing,
  revokeDevice,
  type PairingInput,
} from "./pairing.ts";
import { pairingCreationAllowed } from "./pairing-rate-limit.ts";
import { acceptDesktopEvent } from "./desktop/events.ts";
import { contractRefusal, desktopErrorResponse } from "./desktop/contract.ts";
import { handleDesktopExploreRoute } from "./desktop/explore-routes.ts";
import {
  ingestObservationBatch,
  nextScoutClientObservationSequence,
  ScoutClientObservationConflict,
  startAcceptedClientMatches,
} from "./ingress.ts";
import { ClientBindingReconciliationPending } from "./late-binding.ts";
import { MAX_REPLAY_BYTES, uploadReplay } from "./replay-upload.ts";
import { ReplayUploadError } from "./replay/upload-result.ts";
import { drainRequestBody } from "./replay/drain.ts";
import { ReplayOfferRequestSchema, decideReplayOffer } from "./replay/offer.ts";

const API_PREFIX = "/api/scout-client/v1";
const EXCHANGE_PATH =
  /^\/api\/scout-client\/v1\/pairings\/([0-9a-f-]{36})\/exchange$/;
const REPLAY_PATH = /^\/api\/scout-client\/v1\/replays\/(\d{1,32})$/;
const REPLAY_OFFER_PATH =
  /^\/api\/scout-client\/v1\/replays\/(\d{1,32})\/offer$/;
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

/**
 * A distinct status every released client already treats as a failed request,
 * so an older build keeps its outbox and a current one reads the typed body.
 */
function upgradeRequiredResponse(
  refusal: ScoutClientUpgradeRequired,
): Response {
  return jsonResponse(refusal, SCOUT_CLIENT_UPGRADE_REQUIRED_STATUS);
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

function pairingRateLimited(): Response {
  const response = jsonResponse({ error: "rate_limited" }, 429);
  response.headers.set("Retry-After", "60");
  return response;
}

/**
 * The original pairing route: an `ingest` credential, and the response body
 * every released client parses strictly, so it never gains a field.
 */
async function handleIngestPairing(request: Request): Promise<Response> {
  if (!pairingCreationAllowed(request)) return pairingRateLimited();
  const input = ScoutClientCreatePairingSchema.safeParse(
    await boundedJson(request),
  );
  if (!input.success) return jsonResponse({ error: "invalid_request" }, 400);
  const { pairingId, pairingSecret, approvalUrl, expiresAt } =
    await createPairing(input.data satisfies PairingInput);
  return jsonResponse(
    { pairingId, pairingSecret, approvalUrl, expiresAt },
    201,
  );
}

/**
 * A desktop pairing that asks its approver for `ingest` and `explore`, and
 * returns the match code the approval page shows beside the request.
 */
async function handleDesktopPairing(request: Request): Promise<Response> {
  const refusal = contractRefusal(request);
  if (refusal !== null) return refusal;
  if (!pairingCreationAllowed(request))
    return desktopErrorResponse(
      "rate_limited",
      "Too many pairing requests. Try again in a minute.",
    );
  const input = ScoutClientCreatePairingSchema.safeParse(
    await boundedJson(request),
  );
  if (!input.success)
    return desktopErrorResponse(
      "invalid_request",
      "The pairing request is not valid.",
    );
  const pairing = await createPairing(
    input.data satisfies PairingInput,
    new Date(),
    SCOUT_DESKTOP_PAIRING_V2_SCOPES,
  );
  return jsonResponse(ScoutDesktopPairingV2ResponseSchema.parse(pairing), 201);
}

async function handlePairingRoute(
  request: Request,
  pathname: string,
): Promise<Response | null> {
  if (pathname === `${API_PREFIX}/pairings`) {
    return await handleIngestPairing(request);
  }
  if (pathname === SCOUT_DESKTOP_API_ROUTES.pairings_v2.path) {
    return await handleDesktopPairing(request);
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

async function handleCheckIn(
  request: Request,
  device: AuthenticatedScoutClient,
): Promise<Response> {
  const input = ScoutClientCheckInSchema.safeParse(await boundedJson(request));
  if (!input.success) return jsonResponse({ error: "invalid_request" }, 400);
  // Refused before the device records the build, so an old build never
  // becomes the version a later batch is judged by.
  const upgrade = clientUpgradeRequired(input.data.appVersion);
  if (upgrade !== null) return upgradeRequiredResponse(upgrade);
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
      nextSequence: nextScoutClientObservationSequence(sequence._max.sequence),
    }),
  );
}

async function handleDesktopEvent(
  request: Request,
  device: AuthenticatedScoutClient,
): Promise<Response> {
  const result = acceptDesktopEvent(device, await boundedJson(request));
  if (result.status === 202) return jsonResponse({ accepted: true }, 202);
  const response = jsonResponse({ error: result.error }, result.status);
  if (result.status === 429) response.headers.set("Retry-After", "60");
  return response;
}

async function handleReplayOffer(
  request: Request,
  gameId: string | undefined,
  device: AuthenticatedScoutClient,
): Promise<Response> {
  if (gameId === undefined) return jsonResponse({ error: "not_found" }, 404);
  const offer = ReplayOfferRequestSchema.safeParse(await boundedJson(request));
  return offer.success
    ? jsonResponse(await decideReplayOffer(gameId, offer.data, device))
    : jsonResponse({ error: "invalid_request" }, 400);
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

  const offerMatch = REPLAY_OFFER_PATH.exec(pathname);
  if (offerMatch !== null) {
    return await handleReplayOffer(request, offerMatch[1], device);
  }

  if (pathname === `${API_PREFIX}/check-ins`) {
    return await handleCheckIn(request, device);
  }

  if (pathname === SCOUT_DESKTOP_EVENTS_PATH) {
    return await handleDesktopEvent(request, device);
  }

  if (pathname === SELF_REVOKE_PATH) {
    await revokeDevice(device.deviceId, device.ownerId);
    return jsonResponse({ revoked: true });
  }

  if (pathname === `${API_PREFIX}/observations/batch`) {
    // The running build is the one the device last checked in with; the
    // observations themselves may predate it and stay acceptable.
    const upgrade = clientUpgradeRequired(device.appVersion);
    if (upgrade !== null) return upgradeRequiredResponse(upgrade);
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

async function disabledClientResponse(
  request: Request,
  replayMatch: RegExpExecArray | null,
): Promise<Response> {
  if (replayMatch !== null) await drainRequestBody(request, MAX_REPLAY_BYTES);
  return jsonResponse({ error: "scout_client_disabled" }, 403);
}

export async function handleScoutClientRoute(
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (!url.pathname.startsWith(API_PREFIX)) return null;
  // Explore answers as the device's owner and is gated by the `explore` scope
  // and Explore access, not by the capture kill switch below.
  const desktopResponse = await handleDesktopExploreRoute(
    request,
    url.pathname,
  );
  if (desktopResponse !== null) return desktopResponse;
  const replayMatch = REPLAY_PATH.exec(url.pathname);
  // Decided from Flipt before any pairing, authentication or body read, so a
  // closed environment touches no database. Self-revocation stays open: a
  // device must always be able to give up its own credential.
  if (
    url.pathname !== SELF_REVOKE_PATH &&
    !(await isScoutClientLive("scout_client_ingestion"))
  ) {
    return await disabledClientResponse(request, replayMatch);
  }
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
    if (device === null) {
      // An unauthorized replay PUT is refused before a body byte is read, and
      // closing under an in-flight upload is what the proxy turns into a 502.
      if (replayMatch !== null)
        await drainRequestBody(request, MAX_REPLAY_BYTES);
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    return await handleAuthenticatedRoute(
      request,
      url.pathname,
      replayMatch,
      device,
    );
  } catch (error) {
    const response = typedErrorResponse(error);
    if (response === null) throw error;
    return response;
  }
}

/** Answer the failures this boundary expects; anything else is a 500. */
function typedErrorResponse(error: unknown): Response | null {
  if (error instanceof ScoutClientRequestError) {
    return new Response(error.message, { status: error.status });
  }
  if (error instanceof ScoutClientObservationConflict) {
    return jsonResponse({ error: "observation_conflict" }, 409);
  }
  if (error instanceof ClientBindingReconciliationPending) {
    // The observations are durable; the outbox keeps the batch and retries
    // the idempotent call once the match Workflow commits its stages.
    const response = jsonResponse(
      { error: "binding_reconciliation_pending", message: error.message },
      503,
    );
    response.headers.set("Retry-After", "5");
    return response;
  }
  return error instanceof ReplayUploadError
    ? jsonResponse(
        { error: "replay_rejected", message: error.message },
        error.status,
      )
    : null;
}
