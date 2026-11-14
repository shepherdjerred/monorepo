import { z } from "zod";
import {
  ExploreActiveRunSchema,
  ExploreConversationIdSchema,
  ExploreConversationSchema,
  ExploreMessageSchema,
  ExploreQuotaSnapshotSchema,
  ExploreStreamEventSchema,
} from "#src/model/reports/explore.ts";

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
 */
export const SCOUT_DESKTOP_CONTRACT_VERSION = 2;
export const SCOUT_DESKTOP_MINIMUM_CONTRACT_VERSION = 1;
export const SCOUT_DESKTOP_CONTRACT_HEADER = "X-Scout-Desktop-Contract";
/** The first contract version that knows the `desktop` conversation origin. */
export const SCOUT_DESKTOP_ORIGIN_CONTRACT_VERSION = 2;

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

/** How a route answers: one JSON body, or a `text/event-stream` of events. */
export const ScoutDesktopRouteResponseKindSchema = z.enum([
  "json",
  "event-stream",
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
  "explore_status",
  "explore_conversations_list",
  "explore_conversations_get",
  "explore_runs_start",
  "explore_runs_stop",
  "explore_runs_active",
  "explore_runs_outcome",
  "explore_runs_stream",
]);

/** Every typed refusal a desktop route answers with, and its HTTP status. */
export const SCOUT_DESKTOP_API_ERRORS = {
  invalid_request: 400,
  invalid_turn: 400,
  unauthorized: 401,
  reauthorize_required: 401,
  scope_required: 403,
  explore_forbidden: 403,
  not_found: 404,
  conversation_busy: 409,
  contract_unsupported: 426,
  rate_limited: 429,
  quota_exceeded: 429,
  stream_limit: 429,
  unavailable: 503,
} as const;
export const ScoutDesktopApiErrorCodeSchema = z.enum([
  "invalid_request",
  "invalid_turn",
  "unauthorized",
  "reauthorize_required",
  "scope_required",
  "explore_forbidden",
  "not_found",
  "conversation_busy",
  "contract_unsupported",
  "rate_limited",
  "quota_exceeded",
  "stream_limit",
  "unavailable",
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
 * | `runs/start`   | `ExploreTurnRequestSchema`       | `ExploreActiveRunSchema`              |
 * | `runs/stop`    | `ExploreRunObserveRequestSchema` | `ScoutDesktopRunStopResponseSchema`   |
 * | `runs/active`  | `ScoutDesktopEmptyRequestSchema` | `ScoutDesktopRunActiveResponseSchema` |
 * | `runs/outcome` | `ExploreRunObserveRequestSchema` | `ExploreRunOutcomeResultSchema`       |
 * | `runs/stream`  | `ExploreRunObserveRequestSchema` | `ScoutDesktopRunStreamResponseSchema` |
 *
 * `runs/start` is answered by the same `exploreRunManager.start` as the web's
 * `explore.start`, so a desktop turn spends the owner's one Explore quota.
 */
export const ScoutDesktopEmptyRequestSchema = z.strictObject({});

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
