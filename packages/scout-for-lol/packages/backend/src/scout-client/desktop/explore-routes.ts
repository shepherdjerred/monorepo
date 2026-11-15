import {
  EXPLORE_REQUEST_MAX_BYTES,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_ORIGIN_CONTRACT_VERSION,
  SCOUT_DESKTOP_PNG_CONTENT_TYPE,
  ScoutDesktopEmptyRequestSchema,
  ScoutDesktopVisualizationRequestSchema,
  latestVersion,
  type ScoutDesktopAssetsResponse,
  ScoutDesktopConversationGetRequestSchema,
  ScoutDesktopConversationGetResponseSchema,
  ScoutDesktopConversationListRequestSchema,
  ScoutDesktopConversationListResponseSchema,
  ScoutDesktopExploreStatusRequestSchema,
  exploreOriginForPreDesktopReader,
  type ExploreConversationOrigin,
  type ScoutDesktopExploreStatusResponse,
} from "@scout-for-lol/data";
import { visualizationSnapshotToImage } from "@scout-for-lol/report";
import { prisma } from "#src/database/index.ts";
import { exploreStatusFor } from "#src/explore/spending/status.ts";
import {
  listExploreConversations,
  loadExploreTranscript,
  loadExploreVisualization,
} from "#src/explore/store.ts";
import { readBodyWithinLimit } from "#src/utils/bounded-request-body.ts";
import { authenticateDesktopExplore } from "./auth.ts";
import {
  acceptedContractVersion,
  contractUnsupportedResponse,
  desktopErrorResponse,
  desktopHeaders,
  desktopJsonResponse,
} from "./contract.ts";
import { DESKTOP_ACTION_ROUTES } from "./explore-action-routes.ts";
import {
  DESKTOP_RUN_ROUTES,
  invalidRequest,
  type DesktopRoute,
  type DesktopRouteHandler,
} from "./explore-run-routes.ts";
import { desktopRenderAllowed } from "./rate-limit.ts";

/**
 * Explore over REST for Scout Desktop.
 *
 * Each route calls the same store, status or run-manager function its tRPC
 * procedure calls, so the desktop and the web share one implementation. The
 * conversation reads and an answer's visuals live here; starting, stopping
 * and observing runs live in `explore-run-routes.ts`.
 *
 * Charts are drawn by the same `visualizationSnapshotToImage` Discord posts,
 * so every chart kind the web draws works on the desktop without a native
 * renderer; the desktop draws only the contract's native kinds itself. Card
 * art comes straight from Data Dragon at the version this server's asset
 * bundle was built from, so the client never pins one.
 */

/** Read bodies are a handful of ids; anything larger is not a read. */
const MAX_READ_BODY_BYTES = 4096;

/** The origin as this client's contract version knows it. */
function originFor(
  contractVersion: number,
  origin: ExploreConversationOrigin,
): ExploreConversationOrigin {
  return contractVersion >= SCOUT_DESKTOP_ORIGIN_CONTRACT_VERSION
    ? origin
    : exploreOriginForPreDesktopReader(origin);
}

const exploreStatus: DesktopRouteHandler = async ({ caller, body }) => {
  if (!ScoutDesktopExploreStatusRequestSchema.safeParse(body).success) {
    return invalidRequest();
  }
  const status: ScoutDesktopExploreStatusResponse = await exploreStatusFor(
    caller.userId,
  );
  return desktopJsonResponse(status);
};

const listConversations: DesktopRouteHandler = async ({
  caller,
  body,
  contractVersion,
}) => {
  if (!ScoutDesktopConversationListRequestSchema.safeParse(body).success) {
    return invalidRequest();
  }
  const conversations = await listExploreConversations(prisma, caller.userId);
  return desktopJsonResponse(
    ScoutDesktopConversationListResponseSchema.parse({
      conversations: conversations.map(
        ({ preferredModel: _preferred, ...conversation }) => ({
          ...conversation,
          origin: originFor(contractVersion, conversation.origin),
        }),
      ),
    }),
  );
};

const getConversation: DesktopRouteHandler = async ({
  caller,
  body,
  contractVersion,
}) => {
  const input = ScoutDesktopConversationGetRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  const transcript = await loadExploreTranscript(
    prisma,
    input.data.conversationId,
    caller.userId,
  );
  // Another user's conversation is indistinguishable from a missing one.
  return transcript === null
    ? desktopErrorResponse("not_found", "Conversation not found.")
    : desktopJsonResponse(
        ScoutDesktopConversationGetResponseSchema.parse({
          ...transcript,
          conversation: {
            ...transcript.conversation,
            origin: originFor(contractVersion, transcript.conversation.origin),
          },
        }),
      );
};

const ASSETS: ScoutDesktopAssetsResponse = {
  dataDragonVersion: latestVersion,
};

const assets: DesktopRouteHandler = ({ body }) =>
  Promise.resolve(
    ScoutDesktopEmptyRequestSchema.safeParse(body).success
      ? desktopJsonResponse(ASSETS)
      : invalidRequest(),
  );

const visualization: DesktopRouteHandler = async ({ caller, body }) => {
  const input = ScoutDesktopVisualizationRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  // Counted before the read, so a device that loops on a missing chart
  // spends its render budget too.
  if (!desktopRenderAllowed(caller.device.deviceId)) {
    return desktopErrorResponse(
      "rate_limited",
      "Too many charts from this device. Try again shortly.",
    );
  }
  const snapshot = await loadExploreVisualization(prisma, {
    conversationId: input.data.conversationId,
    messageId: input.data.messageId,
    userId: caller.userId,
  });
  // Another user's answer is indistinguishable from one without a chart.
  if (snapshot === null) {
    return desktopErrorResponse("not_found", "Chart not found.");
  }
  return new Response(new Uint8Array(visualizationSnapshotToImage(snapshot)), {
    status: 200,
    headers: {
      ...desktopHeaders(),
      "Content-Type": SCOUT_DESKTOP_PNG_CONTENT_TYPE,
    },
  });
};

const ROUTES = new Map<string, DesktopRoute>([
  [
    SCOUT_DESKTOP_API_ROUTES.explore_status.path,
    { handler: exploreStatus, maxBodyBytes: MAX_READ_BODY_BYTES },
  ],
  [
    SCOUT_DESKTOP_API_ROUTES.explore_conversations_list.path,
    { handler: listConversations, maxBodyBytes: MAX_READ_BODY_BYTES },
  ],
  [
    SCOUT_DESKTOP_API_ROUTES.explore_conversations_get.path,
    { handler: getConversation, maxBodyBytes: MAX_READ_BODY_BYTES },
  ],
  [
    SCOUT_DESKTOP_API_ROUTES.explore_assets.path,
    { handler: assets, maxBodyBytes: MAX_READ_BODY_BYTES },
  ],
  [
    SCOUT_DESKTOP_API_ROUTES.explore_visualization.path,
    { handler: visualization, maxBodyBytes: MAX_READ_BODY_BYTES },
  ],
  ...DESKTOP_ACTION_ROUTES,
  ...DESKTOP_RUN_ROUTES.map(
    ({ path, handler, turn }) =>
      [
        path,
        {
          handler,
          maxBodyBytes: turn ? EXPLORE_REQUEST_MAX_BYTES : MAX_READ_BODY_BYTES,
        },
      ] as const,
  ),
]);

export const INVALID_BODY = Symbol("invalid body");

/** The JSON body, or {@link INVALID_BODY} for anything a route cannot take. */
export async function readDesktopBody(
  request: Request,
  maxBodyBytes: number,
): Promise<unknown> {
  if (
    request.headers.get("Content-Type")?.startsWith("application/json") !== true
  ) {
    return INVALID_BODY;
  }
  const body = await readBodyWithinLimit(request, maxBodyBytes);
  if (!body.ok) return INVALID_BODY;
  try {
    const parsed: unknown = JSON.parse(body.text);
    return parsed;
  } catch {
    return INVALID_BODY;
  }
}

/**
 * Answer a desktop Explore route, or null when the path is not one.
 *
 * Order matters: the contract check and authentication run before the body is
 * read, so an old client or a missing credential costs no parsing, and the
 * per-device limit runs before any Discord or Explore read.
 */
export async function handleDesktopExploreRoute(
  request: Request,
  pathname: string,
): Promise<Response | null> {
  const route = ROUTES.get(pathname);
  if (route === undefined) return null;
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }
  const contractVersion = acceptedContractVersion(request);
  if (contractVersion === null) return contractUnsupportedResponse();
  const auth = await authenticateDesktopExplore(request);
  if (!auth.ok) return auth.response;
  const body = await readDesktopBody(request, route.maxBodyBytes);
  return body === INVALID_BODY
    ? invalidRequest()
    : await route.handler({
        caller: auth.caller,
        body,
        request,
        contractVersion,
      });
}
