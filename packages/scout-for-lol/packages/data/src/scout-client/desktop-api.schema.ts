import { z } from "zod";
import {
  ExploreActiveRunSchema,
  ExploreConversationIdSchema,
  ExploreConversationSchema,
  ExploreMessageSchema,
  ExploreQuotaSnapshotSchema,
  ExploreShareTokenSchema,
  ExploreStreamEventSchema,
  EXPLORE_REQUEST_MAX_BYTES,
  ExploreTurnRequestSchema,
} from "#src/model/reports/explore.ts";
import { ExploreModelSchema } from "#src/model/reports/explore-model.ts";
import {
  EXPLORE_ATTACHMENT_MAX_BYTES,
  ExploreAttachmentMediaTypeSchema,
} from "#src/model/reports/explore-attachment.ts";
import {
  COACH_GAME_CONTEXT_MAX_BYTES,
  CoachGameContextSchema,
} from "./coach-context.schema.ts";

/**
 * The authenticated REST surface Scout Desktop reads Explore through.
 *
 * The language-neutral source of truth is `desktop-api.contract.json`; the
 * golden request and response bodies live in `desktop-fixtures/`. The Rust
 * client parses the same contract and fixtures with strict serde types, and
 * `desktop-api.schema.test.ts` fails if either side drifts.
 *
 * Every body is strict in both directions, so an existing route never gains a
 * field: a change ships as a new route and a contract version bump. An
 * existing enum never gains a member for a client that predates it either:
 * the server down-shapes to the client's declared version.
 *
 * Versions:
 * - 1: pairing v2, Explore status and conversation reads.
 * - 2: run start, stop, active, outcome and stream, and the `desktop`
 *   conversation origin, which a version-1 client is told is `web`.
 * - 3: scope requests, which add a scope to an already paired device.
 * - 4: the game asset version (`explore/assets`) and server-rendered chart
 *   images (`explore/visualization`), the first route that answers a PNG.
 * - 5: chat actions: the model list, switching versions of a branched turn,
 *   share links, and image uploads. Editing and regenerating are not routes of
 *   their own: they are `runs/start` with an `attach` point, as on the web.
 * - 6: `runs/start` takes an optional `gameContext` (`coach-context.schema.json`)
 *   on a question the player typed, refused as `invalid_game_context` when it
 *   breaks that contract. It is the one request field an existing route has
 *   gained: a request field changes nothing a client reads, a client that
 *   predates it never sends it, and the code it can be refused with is
 *   answered only to a client that sent one. The server deploys first.
 * - 7: multiple-choice coach answers. A message in `conversations/get` may
 *   carry `coachOptions` (2 to 4 labeled options); the server leaves the key
 *   out for a client on an earlier version, whose strict message type would
 *   refuse it. `runs/start-app` is the one route on which Scout starts a turn
 *   itself (a pick or ban changed, or the game began): it takes no question,
 *   only an initiation and the section that initiation may carry, never live
 *   state. The server deploys first.
 * - 8: `coach/voice/turns`, a spoken question: one finished WAV utterance in,
 *   an event stream of the transcript, the answer and its speech out. It is
 *   the second event-stream route, with its own event and refusal vocabulary
 *   (`voiceTurn` in the contract), so no `runs/stream` reader sees a new
 *   event. A message's `generation.reasoningEffort` gains `low`, the in-game
 *   coach's; an older client is sent no provenance for such an answer. The
 *   server deploys first.
 * - 10: `coach/triggers`, a proactive coach turn Scout Desktop's beta build
 *   asks for when a scoreboard detector fires (`coach-trigger.schema.ts`): a
 *   trigger kind, its evidence and the live snapshot, never free text. It is
 *   refused in production whatever the flags say. The server deploys first.
 * - 11: `coach/triggers/speech`, the spoken form of a finished proactive
 *   turn's answer for a beta build in voice conversation mode
 *   (`coach-trigger.schema.ts`): a run id in, PCM chunks out. Refused in
 *   production like the trigger. The server deploys first.
 */
export const SCOUT_DESKTOP_CONTRACT_VERSION = 11;
export const SCOUT_DESKTOP_MINIMUM_CONTRACT_VERSION = 1;
export const SCOUT_DESKTOP_CONTRACT_HEADER = "X-Scout-Desktop-Contract";
/** The first contract version whose messages may carry `coachOptions`. */
export const SCOUT_DESKTOP_COACH_OPTIONS_CONTRACT_VERSION = 7;
/** The first contract version with the `coach/reviews/get` route. */
export const SCOUT_DESKTOP_COACH_REVIEWS_CONTRACT_VERSION = 9;
/** The first contract version that knows the `desktop` conversation origin. */
export const SCOUT_DESKTOP_ORIGIN_CONTRACT_VERSION = 2;
/** The first contract version that knows `low` reasoning effort. */
export const SCOUT_DESKTOP_LOW_EFFORT_CONTRACT_VERSION = 8;

/**
 * What a device credential may do. `ingest` is every capture route the
 * client has always used; `explore` reads and answers Explore as the
 * device's owner. A credential holds exactly the scopes its pairing asked for
 * and its owner approved.
 */
export const ScoutDesktopScopeSchema = z.enum(["ingest", "explore"]);
export type ScoutDesktopScope = z.infer<typeof ScoutDesktopScopeSchema>;

/** The scopes a `pairings/v2` request asks its approver for. */
export const SCOUT_DESKTOP_PAIRING_V2_SCOPES = [
  "ingest",
  "explore",
] as const satisfies readonly ScoutDesktopScope[];

/**
 * How a route answers: one JSON body, a `text/event-stream` of events, or one
 * `image/png` body.
 */
export const ScoutDesktopRouteResponseKindSchema = z.enum([
  "json",
  "event-stream",
  "png",
]);
export type ScoutDesktopRouteResponseKind = z.infer<
  typeof ScoutDesktopRouteResponseKindSchema
>;

export const SCOUT_DESKTOP_API_ROUTES = {
  pairings_v2: {
    method: "POST",
    path: "/api/scout-client/v1/pairings/v2",
    scope: null,
    response: "json",
  },
  device_scope_requests: {
    method: "POST",
    path: "/api/scout-client/v1/devices/current/scope-requests",
    scope: null,
    response: "json",
  },
  explore_status: {
    method: "POST",
    path: "/api/scout-client/v1/explore/status",
    scope: "explore",
    response: "json",
  },
  explore_conversations_list: {
    method: "POST",
    path: "/api/scout-client/v1/explore/conversations/list",
    scope: "explore",
    response: "json",
  },
  explore_conversations_get: {
    method: "POST",
    path: "/api/scout-client/v1/explore/conversations/get",
    scope: "explore",
    response: "json",
  },
  explore_runs_start: {
    method: "POST",
    path: "/api/scout-client/v1/explore/runs/start",
    scope: "explore",
    response: "json",
  },
  explore_runs_start_app: {
    method: "POST",
    path: "/api/scout-client/v1/explore/runs/start-app",
    scope: "explore",
    response: "json",
  },
  explore_runs_stop: {
    method: "POST",
    path: "/api/scout-client/v1/explore/runs/stop",
    scope: "explore",
    response: "json",
  },
  explore_runs_active: {
    method: "POST",
    path: "/api/scout-client/v1/explore/runs/active",
    scope: "explore",
    response: "json",
  },
  explore_runs_outcome: {
    method: "POST",
    path: "/api/scout-client/v1/explore/runs/outcome",
    scope: "explore",
    response: "json",
  },
  explore_runs_stream: {
    method: "POST",
    path: "/api/scout-client/v1/explore/runs/stream",
    scope: "explore",
    response: "event-stream",
  },
  explore_assets: {
    method: "POST",
    path: "/api/scout-client/v1/explore/assets",
    scope: "explore",
    response: "json",
  },
  explore_visualization: {
    method: "POST",
    path: "/api/scout-client/v1/explore/visualization",
    scope: "explore",
    response: "png",
  },
  explore_models: {
    method: "POST",
    path: "/api/scout-client/v1/explore/models",
    scope: "explore",
    response: "json",
  },
  explore_conversations_set_leaf: {
    method: "POST",
    path: "/api/scout-client/v1/explore/conversations/set-leaf",
    scope: "explore",
    response: "json",
  },
  explore_conversations_share: {
    method: "POST",
    path: "/api/scout-client/v1/explore/conversations/share",
    scope: "explore",
    response: "json",
  },
  explore_conversations_revoke_share: {
    method: "POST",
    path: "/api/scout-client/v1/explore/conversations/revoke-share",
    scope: "explore",
    response: "json",
  },
  explore_attachments_upload: {
    method: "POST",
    path: "/api/scout-client/v1/explore/attachments/upload",
    scope: "explore",
    response: "json",
  },
  explore_attachments_discard: {
    method: "POST",
    path: "/api/scout-client/v1/explore/attachments/discard",
    scope: "explore",
    response: "json",
  },
  coach_voice_turns: {
    method: "POST",
    path: "/api/scout-client/v1/coach/voice/turns",
    scope: "explore",
    response: "event-stream",
  },
  coach_reviews_get: {
    method: "POST",
    path: "/api/scout-client/v1/coach/reviews/get",
    scope: "explore",
    response: "json",
  },
  coach_triggers: {
    method: "POST",
    path: "/api/scout-client/v1/coach/triggers",
    scope: "explore",
    response: "json",
  },
  coach_triggers_speech: {
    method: "POST",
    path: "/api/scout-client/v1/coach/triggers/speech",
    scope: "explore",
    response: "json",
  },
} as const satisfies Record<
  string,
  {
    method: "POST";
    path: string;
    scope: ScoutDesktopScope | null;
    response: ScoutDesktopRouteResponseKind;
  }
>;
export type ScoutDesktopApiRoute = keyof typeof SCOUT_DESKTOP_API_ROUTES;
export const ScoutDesktopApiRouteSchema = z.enum([
  "pairings_v2",
  "device_scope_requests",
  "explore_status",
  "explore_conversations_list",
  "explore_conversations_get",
  "explore_runs_start",
  "explore_runs_start_app",
  "explore_runs_stop",
  "explore_runs_active",
  "explore_runs_outcome",
  "explore_runs_stream",
  "explore_assets",
  "explore_visualization",
  "explore_models",
  "explore_conversations_set_leaf",
  "explore_conversations_share",
  "explore_conversations_revoke_share",
  "explore_attachments_upload",
  "explore_attachments_discard",
  "coach_voice_turns",
  "coach_reviews_get",
  "coach_triggers",
  "coach_triggers_speech",
]);

/** Every typed refusal a desktop route answers with, and its HTTP status. */
export const SCOUT_DESKTOP_API_ERRORS = {
  invalid_request: 400,
  invalid_turn: 400,
  invalid_game_context: 400,
  unauthorized: 401,
  reauthorize_required: 401,
  scope_required: 403,
  explore_forbidden: 403,
  not_found: 404,
  conversation_busy: 409,
  scope_already_granted: 409,
  contract_unsupported: 426,
  rate_limited: 429,
  quota_exceeded: 429,
  stream_limit: 429,
  unavailable: 503,
  feature_disabled: 503,
} as const;
export const ScoutDesktopApiErrorCodeSchema = z.enum([
  "invalid_request",
  "invalid_turn",
  "invalid_game_context",
  "unauthorized",
  "reauthorize_required",
  "scope_required",
  "explore_forbidden",
  "not_found",
  "conversation_busy",
  "scope_already_granted",
  "contract_unsupported",
  "rate_limited",
  "quota_exceeded",
  "stream_limit",
  "unavailable",
  "feature_disabled",
]);
export type ScoutDesktopApiErrorCode = z.infer<
  typeof ScoutDesktopApiErrorCodeSchema
>;

export const ScoutDesktopApiErrorSchema = z.strictObject({
  error: ScoutDesktopApiErrorCodeSchema,
  message: z.string().min(1).max(500),
});
export type ScoutDesktopApiError = z.infer<typeof ScoutDesktopApiErrorSchema>;

/**
 * Six characters from an alphabet without look-alikes, shown on both the
 * desktop and the approval page so the approver can tell the request on the
 * page is the one their own computer started.
 */
export const ScoutDesktopPairingMatchCodeSchema = z
  .string()
  .regex(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);

export const ScoutDesktopPairingV2ResponseSchema = z.strictObject({
  pairingId: z.uuid(),
  pairingSecret: z.string().min(32).max(256),
  approvalUrl: z.url(),
  expiresAt: z.iso.datetime(),
  scopes: z.array(ScoutDesktopScopeSchema).min(1),
  matchCode: ScoutDesktopPairingMatchCodeSchema,
});

/**
 * A paired device asking for scopes it lacks. The device keeps its identity
 * and token; the request only gives its owner something to approve on the web,
 * and a device can never grant itself a scope.
 */
export const ScoutDesktopScopeRequestSchema = z.strictObject({
  scopes: z.array(ScoutDesktopScopeSchema).min(1).max(2),
});

export const ScoutDesktopScopeRequestResponseSchema = z.strictObject({
  requestId: z.uuid(),
  approvalUrl: z.url(),
  expiresAt: z.iso.datetime(),
  scopes: z.array(ScoutDesktopScopeSchema).min(1),
  matchCode: ScoutDesktopPairingMatchCodeSchema,
});
export type ScoutDesktopScopeRequestResponse = z.infer<
  typeof ScoutDesktopScopeRequestResponseSchema
>;

export const ScoutDesktopExploreStatusRequestSchema = z.strictObject({});

const MicrosSchema = z.number().int().nonnegative();
export const ScoutDesktopExploreStatusResponseSchema = z.strictObject({
  modelPickerEnabled: z.boolean(),
  spending: z.strictObject({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    globalUsedMicros: MicrosSchema,
    userUsedMicros: MicrosSchema,
    globalRemainingMicros: MicrosSchema,
    userRemainingMicros: MicrosSchema,
    resetsAt: z.iso.datetime(),
  }),
  quota: z.array(ExploreQuotaSnapshotSchema),
});
export type ScoutDesktopExploreStatusResponse = z.infer<
  typeof ScoutDesktopExploreStatusResponseSchema
>;

export const ScoutDesktopConversationListRequestSchema = z.strictObject({});
export const ScoutDesktopConversationListResponseSchema = z.strictObject({
  conversations: z.array(
    ExploreConversationSchema.omit({ preferredModel: true }),
  ),
});

export const ScoutDesktopConversationGetRequestSchema = z.strictObject({
  conversationId: ExploreConversationIdSchema,
});
/** The whole transcript, as the web's current bundle reads it. */
export const ScoutDesktopConversationGetResponseSchema = z.strictObject({
  conversation: ExploreConversationSchema,
  messages: z.array(ExploreMessageSchema),
});

/*
 * The run routes reuse the web's Explore bodies where one exists, so the two
 * surfaces cannot drift:
 *
 * | Route          | Request                          | Response                              |
 * | -------------- | -------------------------------- | ------------------------------------- |
 * | `runs/start`   | `ScoutDesktopRunStartRequestSchema` | `ExploreActiveRunSchema`           |
 * | `runs/start-app` | `ScoutDesktopAppTurnRequestSchema` (`coach-context.schema.ts`) | `ExploreActiveRunSchema` |
 * | `runs/stop`    | `ExploreRunObserveRequestSchema` | `ScoutDesktopRunStopResponseSchema`   |
 * | `runs/active`  | `ScoutDesktopEmptyRequestSchema` | `ScoutDesktopRunActiveResponseSchema` |
 * | `runs/outcome` | `ExploreRunObserveRequestSchema` | `ExploreRunOutcomeResultSchema`       |
 * | `runs/stream`  | `ExploreRunObserveRequestSchema` | `ScoutDesktopRunStreamResponseSchema` |
 *
 * `runs/start` is answered by the same `exploreRunManager.start` as the web's
 * `explore.start`, so a desktop turn spends the owner's one Explore quota.
 */
export const ScoutDesktopEmptyRequestSchema = z.strictObject({});

/**
 * `runs/start`: the web's turn request, plus the game the player is in when
 * they typed the question. Only a question they typed may carry it, so a
 * regenerate, which names no new question, never does. Whether each section
 * reaches the agent is the server's coach policy, not this schema.
 */
export const ScoutDesktopRunStartRequestSchema =
  ExploreTurnRequestSchema.safeExtend({
    gameContext: CoachGameContextSchema.optional(),
  }).refine(
    (request) => request.gameContext === undefined || request.question !== null,
    {
      message: "Only a question the player typed carries a game context.",
      path: ["gameContext"],
    },
  );
/** The largest `runs/start` body: the web's turn plus the largest context. */
export const SCOUT_DESKTOP_RUN_START_MAX_BYTES =
  EXPLORE_REQUEST_MAX_BYTES + COACH_GAME_CONTEXT_MAX_BYTES;
export type ScoutDesktopRunStartRequest = z.infer<
  typeof ScoutDesktopRunStartRequestSchema
>;

export const ScoutDesktopRunStopResponseSchema = z.strictObject({
  ok: z.literal(true),
});

/** The owner's runs in flight on every surface, oldest first. */
export const ScoutDesktopRunActiveResponseSchema = z.strictObject({
  runs: z.array(ExploreActiveRunSchema),
});

/**
 * The frames of one `runs/stream` response, in order. Each frame is
 * `event: <type>` then `data: <json>`, written by the same SSE writer as the
 * web's `/api/explore/stream`, so the desktop and the browser read one event
 * model. The first frame after attaching is always a `snapshot` (followed by
 * a `run_preview` when a table exists), so a reconnect replaces state rather
 * than appending it twice.
 */
export const ScoutDesktopRunStreamResponseSchema = z.strictObject({
  events: z.array(ExploreStreamEventSchema),
});

/** Every stream event type, in `ExploreStreamEventSchema`'s order. */
export const SCOUT_DESKTOP_STREAM_EVENT_TYPES: readonly string[] =
  ExploreStreamEventSchema.options.map((option) => option.shape.type.value);

/**
 * The chart kinds every Scout surface draws as native text — a table, a list
 * or a headline number — instead of a chart image: Discord as an embed, the
 * desktop as native rows. Every other kind is the PNG
 * `visualizationSnapshotToImage` renders.
 */
export const SCOUT_NATIVE_VISUALIZATION_KINDS: readonly string[] = [
  "TABLE",
  "LIST",
  "LEADERBOARD",
  "KPI_CARD",
];

/**
 * The game asset version the desktop builds Data Dragon image URLs with: the
 * version the server's own asset bundle was built from, so the client never
 * pins one.
 */
export const ScoutDesktopAssetsResponseSchema = z.strictObject({
  dataDragonVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
});
export type ScoutDesktopAssetsResponse = z.infer<
  typeof ScoutDesktopAssetsResponseSchema
>;

/** One persisted answer whose chart to render. */
export const ScoutDesktopVisualizationRequestSchema = z.strictObject({
  conversationId: ExploreConversationIdSchema,
  messageId: z.uuid(),
});

export const SCOUT_DESKTOP_PNG_CONTENT_TYPE = "image/png";

/**
 * A `png` route answers with the image bytes, not JSON. Its golden fixture
 * records the content type, which is all a client may rely on.
 */
export const ScoutDesktopPngResponseSchema = z.strictObject({
  contentType: z.literal(SCOUT_DESKTOP_PNG_CONTENT_TYPE),
});

/*
 * Chat actions (contract version 5). Each calls what its tRPC procedure
 * calls, behind the same device authentication, owner access check and
 * per-device read limit as every other route:
 *
 * | Route                                | Request                                 | Response                               | tRPC procedure           |
 * | ------------------------------------ | --------------------------------------- | -------------------------------------- | ------------------------ |
 * | `explore/models`                     | `ScoutDesktopEmptyRequestSchema`        | `ScoutDesktopModelsResponseSchema`     | `explore.status`         |
 * | `conversations/set-leaf`             | `ScoutDesktopSetLeafRequestSchema`      | `ScoutDesktopOkResponseSchema`         | `explore.setLeaf`        |
 * | `conversations/share`                | `ScoutDesktopConversationGetRequestSchema` | `ScoutDesktopShareResponseSchema`   | `explore.share`          |
 * | `conversations/revoke-share`         | `ScoutDesktopConversationGetRequestSchema` | `ScoutDesktopOkResponseSchema`      | `explore.revokeShare`    |
 * | `attachments/upload`                 | `ScoutDesktopAttachmentUploadRequestSchema` | `ExploreAttachmentSchema`          | `explore.uploadAttachment` |
 * | `attachments/discard`                | `ScoutDesktopAttachmentDiscardRequestSchema` | `ScoutDesktopOkResponseSchema`    | `explore.discardAttachment` |
 *
 * A conversation, message or attachment that is not the owner's is a
 * `not_found`, the same answer a missing one gets.
 */
export const ScoutDesktopOkResponseSchema = z.strictObject({
  ok: z.literal(true),
});

/**
 * The models the owner may choose between, from the source the web's picker
 * uses: the picker's `scout-explore-model-picker-enabled` flag and the shared
 * option list. With the picker off, `models` is empty and the server picks.
 */
export const ScoutDesktopModelsResponseSchema = z.strictObject({
  pickerEnabled: z.boolean(),
  defaultModel: ExploreModelSchema,
  models: z.array(
    z.strictObject({ id: ExploreModelSchema, label: z.string().min(1) }),
  ),
});
export type ScoutDesktopModelsResponse = z.infer<
  typeof ScoutDesktopModelsResponseSchema
>;

/** Switch the branch on screen to the one that runs through `messageId`. */
export const ScoutDesktopSetLeafRequestSchema = z.strictObject({
  conversationId: ExploreConversationIdSchema,
  messageId: z.uuid(),
});

export const ScoutDesktopShareResponseSchema = z.strictObject({
  shareToken: ExploreShareTokenSchema,
});

/**
 * One image for the next question: the web's `explore.uploadAttachment`
 * request. The size and type limits are the web's.
 */
export const ScoutDesktopAttachmentUploadRequestSchema = z.strictObject({
  mediaType: ExploreAttachmentMediaTypeSchema,
  base64: z
    .string()
    .min(4)
    .max(4 * Math.ceil(EXPLORE_ATTACHMENT_MAX_BYTES / 3))
    .regex(/^[A-Z0-9+/]+={0,2}$/i),
});
/** The stored image's reference, the same body the web's upload answers. */
export const ScoutDesktopAttachmentUploadResponseSchema = z.strictObject({
  id: z.uuid(),
  mediaType: ExploreAttachmentMediaTypeSchema,
});

export const ScoutDesktopAttachmentDiscardRequestSchema = z.strictObject({
  id: z.uuid(),
});

/**
 * `coach/reviews/get`: the post-game review the server produced (or is
 * producing) for one finished game the owner recorded. The desktop never
 * starts a review; the server does, once the game's recording and its resolved
 * match are both stored. A game with no review, or one the owner did not
 * record, is a `not_found`, the same answer for both.
 *
 * | Status    | Meaning                                                          |
 * | --------- | ---------------------------------------------------------------- |
 * | `pending` | The Explore turn is running; `conversationId` already links it.  |
 * | `ready`   | The turn finished; read the review in `conversationId`.          |
 * | `declined`| Explore's quota or spend limit refused it; no review will exist. |
 * | `failed`  | The turn ended without an answer.                                |
 */
export const COACH_REVIEW_STATUSES = [
  "pending",
  "ready",
  "declined",
  "failed",
] as const;
export const CoachReviewStatusSchema = z.enum(COACH_REVIEW_STATUSES);
export type CoachReviewStatus = z.infer<typeof CoachReviewStatusSchema>;

export const ScoutDesktopCoachReviewRequestSchema = z.strictObject({
  matchId: z.string().regex(/^[A-Z0-9]{2,6}_\d{1,20}$/),
});

export const ScoutDesktopCoachReviewResponseSchema = z.strictObject({
  matchId: z.string().regex(/^[A-Z0-9]{2,6}_\d{1,20}$/),
  status: CoachReviewStatusSchema,
  /** The Explore conversation holding the review; null once declined. */
  conversationId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
