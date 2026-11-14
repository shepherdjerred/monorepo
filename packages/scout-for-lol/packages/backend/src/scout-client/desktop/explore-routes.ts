import {
  SCOUT_DESKTOP_API_ROUTES,
  ScoutDesktopConversationGetRequestSchema,
  ScoutDesktopConversationGetResponseSchema,
  ScoutDesktopConversationListRequestSchema,
  ScoutDesktopConversationListResponseSchema,
  ScoutDesktopExploreStatusRequestSchema,
  type ScoutDesktopExploreStatusResponse,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { exploreStatusFor } from "#src/explore/spending/status.ts";
import {
  listExploreConversations,
  loadExploreTranscript,
} from "#src/explore/store.ts";
import { readBodyWithinLimit } from "#src/utils/bounded-request-body.ts";
import {
  authenticateDesktopExplore,
  type DesktopExploreCaller,
} from "./auth.ts";
import {
  contractRefusal,
  desktopErrorResponse,
  desktopJsonResponse,
} from "./contract.ts";

/**
 * Read-only Explore over REST for Scout Desktop.
 *
 * Each route calls the same store or status function its tRPC procedure
 * calls, so the desktop and the web read one implementation. Starting,
 * stopping and observing a run arrive with the streaming routes.
 */

/** Read bodies are a handful of ids; anything larger is not a read. */
const MAX_READ_BODY_BYTES = 4096;

type DesktopRouteHandler = (
  caller: DesktopExploreCaller,
  body: unknown,
) => Promise<Response>;

function invalidRequest(): Response {
  return desktopErrorResponse(
    "invalid_request",
    "The request body does not match this route.",
  );
}

const exploreStatus: DesktopRouteHandler = async (caller, body) => {
  if (!ScoutDesktopExploreStatusRequestSchema.safeParse(body).success) {
    return invalidRequest();
  }
  const status: ScoutDesktopExploreStatusResponse = await exploreStatusFor(
    caller.userId,
  );
  return desktopJsonResponse(status);
};

const listConversations: DesktopRouteHandler = async (caller, body) => {
  if (!ScoutDesktopConversationListRequestSchema.safeParse(body).success) {
    return invalidRequest();
  }
  const conversations = await listExploreConversations(prisma, caller.userId);
  return desktopJsonResponse(
    ScoutDesktopConversationListResponseSchema.parse({
      conversations: conversations.map(
        ({ preferredModel: _preferred, ...conversation }) => conversation,
      ),
    }),
  );
};

const getConversation: DesktopRouteHandler = async (caller, body) => {
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
        ScoutDesktopConversationGetResponseSchema.parse(transcript),
      );
};

const HANDLERS = new Map<string, DesktopRouteHandler>([
  [SCOUT_DESKTOP_API_ROUTES.explore_status.path, exploreStatus],
  [SCOUT_DESKTOP_API_ROUTES.explore_conversations_list.path, listConversations],
  [SCOUT_DESKTOP_API_ROUTES.explore_conversations_get.path, getConversation],
]);

const INVALID_BODY = Symbol("invalid body");

/** The JSON body, or {@link INVALID_BODY} for anything a read cannot be. */
async function readBody(request: Request): Promise<unknown> {
  if (
    request.headers.get("Content-Type")?.startsWith("application/json") !== true
  ) {
    return INVALID_BODY;
  }
  const body = await readBodyWithinLimit(request, MAX_READ_BODY_BYTES);
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
  const handler = HANDLERS.get(pathname);
  if (handler === undefined) return null;
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }
  const refusal = contractRefusal(request);
  if (refusal !== null) return refusal;
  const auth = await authenticateDesktopExplore(request);
  if (!auth.ok) return auth.response;
  const body = await readBody(request);
  return body === INVALID_BODY
    ? invalidRequest()
    : await handler(auth.caller, body);
}
