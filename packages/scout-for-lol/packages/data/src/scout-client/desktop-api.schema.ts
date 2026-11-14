import { z } from "zod";
import {
  ExploreConversationIdSchema,
  ExploreConversationSchema,
  ExploreMessageSchema,
  ExploreQuotaSnapshotSchema,
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
 * field: a change ships as a new route and a contract version bump.
 */
export const SCOUT_DESKTOP_CONTRACT_VERSION = 1;
export const SCOUT_DESKTOP_MINIMUM_CONTRACT_VERSION = 1;
export const SCOUT_DESKTOP_CONTRACT_HEADER = "X-Scout-Desktop-Contract";

/**
 * What a device credential may do. `ingest` is every capture route the
 * client has always used; `explore` reads and later answers Explore as the
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

export const SCOUT_DESKTOP_API_ROUTES = {
  pairings_v2: {
    method: "POST",
    path: "/api/scout-client/v1/pairings/v2",
    scope: null,
  },
  explore_status: {
    method: "POST",
    path: "/api/scout-client/v1/explore/status",
    scope: "explore",
  },
  explore_conversations_list: {
    method: "POST",
    path: "/api/scout-client/v1/explore/conversations/list",
    scope: "explore",
  },
  explore_conversations_get: {
    method: "POST",
    path: "/api/scout-client/v1/explore/conversations/get",
    scope: "explore",
  },
} as const satisfies Record<
  string,
  { method: "POST"; path: string; scope: ScoutDesktopScope | null }
>;
export type ScoutDesktopApiRoute = keyof typeof SCOUT_DESKTOP_API_ROUTES;
export const ScoutDesktopApiRouteSchema = z.enum([
  "pairings_v2",
  "explore_status",
  "explore_conversations_list",
  "explore_conversations_get",
]);

/** Every typed refusal a desktop route answers with, and its HTTP status. */
export const SCOUT_DESKTOP_API_ERRORS = {
  invalid_request: 400,
  unauthorized: 401,
  reauthorize_required: 401,
  scope_required: 403,
  explore_forbidden: 403,
  not_found: 404,
  contract_unsupported: 426,
  rate_limited: 429,
  unavailable: 503,
} as const;
export const ScoutDesktopApiErrorCodeSchema = z.enum([
  "invalid_request",
  "unauthorized",
  "reauthorize_required",
  "scope_required",
  "explore_forbidden",
  "not_found",
  "contract_unsupported",
  "rate_limited",
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
