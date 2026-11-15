import {
  DEFAULT_EXPLORE_PICKER_MODEL,
  exploreModelPickerEnabled,
} from "#src/config/dynamic.ts";
import { prisma } from "#src/database/index.ts";
import {
  discardExploreAttachment,
  uploadExploreAttachment,
} from "#src/explore/attachments/storage.ts";
import {
  revokeExploreShare,
  setExploreLeaf,
  shareExploreConversation,
} from "#src/explore/store.ts";
import { scoutExploreSharesTotal } from "#src/metrics/explore.ts";
import {
  EXPLORE_ATTACHMENT_MAX_BYTES,
  EXPLORE_MODEL_OPTIONS,
  ExploreModelSchema,
  SCOUT_DESKTOP_API_ROUTES,
  ScoutDesktopAttachmentDiscardRequestSchema,
  ScoutDesktopAttachmentUploadRequestSchema,
  ScoutDesktopAttachmentUploadResponseSchema,
  ScoutDesktopConversationGetRequestSchema,
  ScoutDesktopEmptyRequestSchema,
  ScoutDesktopModelsResponseSchema,
  ScoutDesktopOkResponseSchema,
  ScoutDesktopSetLeafRequestSchema,
  ScoutDesktopShareResponseSchema,
} from "@scout-for-lol/data";
import { TRPCError } from "@trpc/server";
import {
  desktopErrorResponse,
  desktopJsonResponse,
  writeLimitedResponse,
} from "./contract.ts";
import {
  invalidRequest,
  type DesktopRoute,
  type DesktopRouteHandler,
} from "./explore-run-routes.ts";
import { desktopWriteAllowed, type DesktopWriteKind } from "./rate-limit.ts";

/**
 * The rest of Explore's chat actions over REST for Scout Desktop: the model
 * list, switching versions of a branched turn, share links and image uploads.
 *
 * Each calls the store or storage function its tRPC procedure calls. Editing
 * and regenerating are `runs/start` with an `attach` point (see
 * `explore-run-routes.ts`), as on the web, so they spend the same per-user
 * quota and take the same one-active-run slot.
 *
 * Every conversation, message and image is looked up under the caller's id,
 * so another user's is indistinguishable from a missing one: `not_found`.
 */

/** Check a write limit, then run `handler`. */
export function limitedWrite(
  kind: DesktopWriteKind,
  handler: DesktopRouteHandler,
): DesktopRouteHandler {
  return async (context) =>
    desktopWriteAllowed(kind, context.caller.device.deviceId)
      ? await handler(context)
      : writeLimitedResponse();
}

const conversationNotFound = () =>
  desktopErrorResponse("not_found", "Conversation not found.");

const models: DesktopRouteHandler = ({ body }) => {
  if (!ScoutDesktopEmptyRequestSchema.safeParse(body).success) {
    return Promise.resolve(invalidRequest());
  }
  // The web's picker shows only while `scout-explore-model-picker-enabled` is
  // on; with it off the server chooses and there is nothing to pick.
  const pickerEnabled = exploreModelPickerEnabled();
  return Promise.resolve(
    desktopJsonResponse(
      ScoutDesktopModelsResponseSchema.parse({
        pickerEnabled,
        defaultModel: ExploreModelSchema.parse(DEFAULT_EXPLORE_PICKER_MODEL),
        models: pickerEnabled ? EXPLORE_MODEL_OPTIONS : [],
      }),
    ),
  );
};

const setLeaf: DesktopRouteHandler = async ({ caller, body }) => {
  const input = ScoutDesktopSetLeafRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  const moved = await setExploreLeaf(
    prisma,
    input.data.conversationId,
    caller.userId,
    input.data.messageId,
  );
  return moved
    ? desktopJsonResponse(ScoutDesktopOkResponseSchema.parse({ ok: true }))
    : conversationNotFound();
};

const share: DesktopRouteHandler = async ({ caller, body }) => {
  const input = ScoutDesktopConversationGetRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  const shareToken = await shareExploreConversation(
    prisma,
    input.data.conversationId,
    caller.userId,
  );
  if (shareToken === null) return conversationNotFound();
  scoutExploreSharesTotal.inc({ action: "share" });
  return desktopJsonResponse(
    ScoutDesktopShareResponseSchema.parse({ shareToken }),
  );
};

const revokeShare: DesktopRouteHandler = async ({ caller, body }) => {
  const input = ScoutDesktopConversationGetRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  const revoked = await revokeExploreShare(
    prisma,
    input.data.conversationId,
    caller.userId,
  );
  if (!revoked) return conversationNotFound();
  scoutExploreSharesTotal.inc({ action: "revoke" });
  return desktopJsonResponse(ScoutDesktopOkResponseSchema.parse({ ok: true }));
};

/** The upload caps are per hour and per unsent image; five minutes is a fair wait. */
const UPLOAD_RETRY_AFTER_SECONDS = 300;

const uploadAttachment: DesktopRouteHandler = async ({ caller, body }) => {
  const input = ScoutDesktopAttachmentUploadRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  try {
    return desktopJsonResponse(
      ScoutDesktopAttachmentUploadResponseSchema.parse(
        await uploadExploreAttachment(prisma, caller.userId, input.data),
      ),
    );
  } catch (error) {
    // The store's own refusals: a bad image, the owner's unsent and hourly
    // caps, and missing object storage. Anything else is a bug and surfaces.
    if (!(error instanceof TRPCError)) throw error;
    if (error.code === "BAD_REQUEST") {
      return desktopErrorResponse("invalid_request", error.message);
    }
    if (error.code === "TOO_MANY_REQUESTS") {
      return desktopErrorResponse("quota_exceeded", error.message, {
        retryAfterSeconds: UPLOAD_RETRY_AFTER_SECONDS,
      });
    }
    if (error.code === "SERVICE_UNAVAILABLE") {
      return desktopErrorResponse("unavailable", error.message);
    }
    throw error;
  }
};

const discardAttachment: DesktopRouteHandler = async ({ caller, body }) => {
  const input = ScoutDesktopAttachmentDiscardRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  // Not the owner's, already sent with a question, or gone: all `not_found`.
  return (await discardExploreAttachment(prisma, caller.userId, input.data.id))
    ? desktopJsonResponse(ScoutDesktopOkResponseSchema.parse({ ok: true }))
    : desktopErrorResponse("not_found", "Image not found.");
};

/** Read bodies are a handful of ids. */
const SMALL_BODY_BYTES = 4096;
/** An upload is base64 of at most the web's image cap, plus its envelope. */
export const UPLOAD_BODY_MAX_BYTES =
  4 * Math.ceil(EXPLORE_ATTACHMENT_MAX_BYTES / 3) + 1024;

/** The chat action routes by path. */
export const DESKTOP_ACTION_ROUTES: readonly (readonly [
  string,
  DesktopRoute,
])[] = [
  [
    SCOUT_DESKTOP_API_ROUTES.explore_models.path,
    { handler: models, maxBodyBytes: SMALL_BODY_BYTES },
  ],
  [
    SCOUT_DESKTOP_API_ROUTES.explore_conversations_set_leaf.path,
    { handler: limitedWrite("edit", setLeaf), maxBodyBytes: SMALL_BODY_BYTES },
  ],
  [
    SCOUT_DESKTOP_API_ROUTES.explore_conversations_share.path,
    { handler: limitedWrite("share", share), maxBodyBytes: SMALL_BODY_BYTES },
  ],
  [
    SCOUT_DESKTOP_API_ROUTES.explore_conversations_revoke_share.path,
    {
      handler: limitedWrite("share", revokeShare),
      maxBodyBytes: SMALL_BODY_BYTES,
    },
  ],
  [
    SCOUT_DESKTOP_API_ROUTES.explore_attachments_upload.path,
    {
      handler: limitedWrite("attachment", uploadAttachment),
      maxBodyBytes: UPLOAD_BODY_MAX_BYTES,
    },
  ],
  [
    SCOUT_DESKTOP_API_ROUTES.explore_attachments_discard.path,
    {
      handler: limitedWrite("attachment", discardAttachment),
      maxBodyBytes: SMALL_BODY_BYTES,
    },
  ],
];
