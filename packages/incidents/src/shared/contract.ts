/**
 * Incidents wire contract: the one source of truth for the Hub module's
 * server, its browser pages, `toolkit incident`, and the signal producers
 * (Alertmanager receiver, the Temporal ops-snapshot main-ci signal).
 *
 * Everything that crosses a process boundary is parsed with these schemas on
 * both sides. Unknown enum values fail loudly; producers are fixed instead.
 */
import { z } from "zod";

/** Hub module id: UI under `/incidents`, API under `/api/incidents`. */
export const INCIDENTS_MODULE_ID = "incidents";
export const INCIDENTS_API_PREFIX = "/api/incidents";

/** Human-facing identifier prefix: `INC-42`. */
export const INCIDENT_IDENTIFIER_PREFIX = "INC-";

export const INCIDENT_IDENTIFIER_PATTERN = /^INC-[1-9]\d*$/u;

export function incidentIdentifier(number: number): string {
  return `${INCIDENT_IDENTIFIER_PREFIX}${String(number)}`;
}

/** `INC-42`, `inc-42`, or `42` → 42. Anything else → null. */
export function parseIncidentNumber(value: string): number | null {
  const match = /^(?:inc-)?([1-9]\d*)$/iu.exec(value.trim());
  return match?.[1] === undefined ? null : Number(match[1]);
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Shared systems an incident can affect. Closed on purpose: dedupe ("one open
 * incident per system") only works when every producer names systems the same
 * way. Workload-level detail goes in `components`.
 */
export const INCIDENT_SYSTEMS = [
  "main-ci",
  "delivery",
  "argocd",
  "cluster",
  "observability",
  "temporal",
  "flags",
  "tracker",
  "hub",
  "network",
  "storage",
  "databases",
  "mail",
  "other",
] as const;
export const IncidentSystemSchema = z.enum(INCIDENT_SYSTEMS);
export type IncidentSystem = z.infer<typeof IncidentSystemSchema>;

export const INCIDENT_SYSTEM_LABELS: Readonly<Record<IncidentSystem, string>> =
  {
    "main-ci": "Main CI",
    delivery: "Delivery",
    argocd: "Argo CD",
    cluster: "Cluster",
    observability: "Observability",
    temporal: "Temporal",
    flags: "Flags",
    tracker: "Tracker",
    hub: "Hub",
    network: "Network",
    storage: "Storage",
    databases: "Databases",
    mail: "Mail",
    other: "Other",
  };

export const IncidentKindSchema = z.enum(["incident", "maintenance"]);
export type IncidentKind = z.infer<typeof IncidentKindSchema>;

export const IncidentSeveritySchema = z.enum(["sev1", "sev2", "sev3"]);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

/** Incident lifecycle. `resolved` is terminal until reopened. */
export const INCIDENT_STATUSES = [
  "investigating",
  "identified",
  "mitigating",
  "monitoring",
  "resolved",
] as const;
/** Maintenance lifecycle. `completed` and `canceled` are terminal. */
export const MAINTENANCE_STATUSES = [
  "scheduled",
  "in_progress",
  "verifying",
  "completed",
  "canceled",
] as const;
export const IncidentStatusSchema = z.enum([
  ...INCIDENT_STATUSES,
  ...MAINTENANCE_STATUSES,
]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const TERMINAL_STATUSES: ReadonlySet<IncidentStatus> = new Set([
  "resolved",
  "completed",
  "canceled",
]);

export function isOpenStatus(status: IncidentStatus): boolean {
  return !TERMINAL_STATUSES.has(status);
}

export const IncidentSourceSchema = z.enum([
  "manual",
  "alertmanager",
  "main-ci",
]);
export type IncidentSource = z.infer<typeof IncidentSourceSchema>;

/**
 * Who owns the response. `dispatching` is a short lease held while a new
 * agent session is being spawned to take command; it lapses back to `none`
 * when the spawned session never claims.
 */
export const CommandStateSchema = z.enum(["none", "dispatching", "owned"]);
export type CommandState = z.infer<typeof CommandStateSchema>;

export const IncidentLinkKindSchema = z.enum([
  "pr",
  "pipeline",
  "alert",
  "tracker-issue",
  "forum-thread",
  "delivery-deployment",
  "commit",
  "url",
]);
export type IncidentLinkKind = z.infer<typeof IncidentLinkKindSchema>;

export const IncidentEventTypeSchema = z.enum([
  "declared",
  "update",
  "status-changed",
  "severity-changed",
  "edited",
  "claimed",
  "dispatched",
  "dispatch-expired",
  "handed-off",
  "released",
  "joined",
  "left",
  "link-added",
  "signal-firing",
  "signal-cleared",
  "resolved",
  "reopened",
]);
export type IncidentEventType = z.infer<typeof IncidentEventTypeSchema>;

// ---------------------------------------------------------------------------
// Actor (same shape toolkit already sends Tracker for Forum writes)
// ---------------------------------------------------------------------------

export const ActorKindSchema = z.enum(["human", "agent", "runner", "system"]);
export type ActorKind = z.infer<typeof ActorKindSchema>;

export const ActorMetadataSchema = z
  .object({
    hostname: z.string().optional(),
    cwd: z.string().optional(),
    branch: z.string().optional(),
    worktree: z.string().optional(),
    repoHead: z.string().optional(),
    harness: z.string().optional(),
    sessionId: z.string().optional(),
    harnessVersion: z.string().optional(),
    executable: z.string().optional(),
    sessionLink: z.string().optional(),
    model: z.string().optional(),
    hcTerminal: z.string().optional(),
    parentKey: z.string().optional(),
    plan: z.string().optional(),
  })
  .strict();
export type ActorMetadata = z.infer<typeof ActorMetadataSchema>;

export const ActorInputSchema = z
  .object({
    key: z
      .string()
      .min(3)
      .max(200)
      .regex(/^[a-z0-9][a-z0-9._-]*:\S+$/u),
    kind: ActorKindSchema,
    name: z.string().min(1).max(120),
    metadata: ActorMetadataSchema.optional(),
  })
  .strict();
export type ActorInput = z.infer<typeof ActorInputSchema>;

export const ActorSchema = z.object({
  id: z.string(),
  key: z.string(),
  kind: ActorKindSchema,
  name: z.string(),
  metadata: ActorMetadataSchema.nullable(),
  lastSeenAt: z.iso.datetime(),
});
export type Actor = z.infer<typeof ActorSchema>;

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/** Who most likely caused the incident; lets that session take it over. */
export const IncidentSuspectSchema = z
  .object({
    commitSha: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/u)
      .optional(),
    prNumber: z.number().int().positive().optional(),
    branch: z.string().min(1).optional(),
    /** Harness session id from a `Claude-Session:`-style commit trailer. */
    sessionId: z.string().min(1).optional(),
    author: z.string().min(1).optional(),
  })
  .strict();
export type IncidentSuspect = z.infer<typeof IncidentSuspectSchema>;

export const IncidentLinkInputSchema = z
  .object({
    kind: IncidentLinkKindSchema,
    /** Stable reference: PR number, pipeline number, fingerprint, `AI-123`, `FM-12`, SHA, or URL. */
    ref: z.string().min(1).max(500),
    url: z.url().optional(),
    title: z.string().max(300).optional(),
  })
  .strict();
export type IncidentLinkInput = z.infer<typeof IncidentLinkInputSchema>;

export const IncidentLinkSchema = IncidentLinkInputSchema.extend({
  id: z.string(),
  createdAt: z.iso.datetime(),
});
export type IncidentLink = z.infer<typeof IncidentLinkSchema>;

export const IncidentSignalStateSchema = z.object({
  /** Producer-scoped stable key: Alertmanager fingerprint, or `main-ci:main`. */
  key: z.string(),
  source: IncidentSourceSchema,
  title: z.string(),
  firing: z.boolean(),
  firstFiredAt: z.iso.datetime(),
  lastChangedAt: z.iso.datetime(),
});
export type IncidentSignalState = z.infer<typeof IncidentSignalStateSchema>;

export const CommandSchema = z.object({
  state: CommandStateSchema,
  commander: ActorSchema.nullable(),
  /** Actor holding the dispatch lease while `state === "dispatching"`. */
  dispatcher: ActorSchema.nullable(),
  leaseExpiresAt: z.iso.datetime().nullable(),
  /** Before this instant only the suspect or creator is expected to take command. */
  takeoverEligibleAt: z.iso.datetime(),
});
export type Command = z.infer<typeof CommandSchema>;

export const IncidentSummarySchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  identifier: z.string().regex(INCIDENT_IDENTIFIER_PATTERN),
  kind: IncidentKindSchema,
  title: z.string(),
  severity: IncidentSeveritySchema,
  status: IncidentStatusSchema,
  systems: z.array(IncidentSystemSchema).min(1),
  components: z.array(z.string()),
  source: IncidentSourceSchema,
  command: CommandSchema,
  affectedCount: z.number().int().nonnegative(),
  firingSignals: z.number().int().nonnegative(),
  declaredAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  scheduledStart: z.iso.datetime().nullable(),
  scheduledEnd: z.iso.datetime().nullable(),
  revision: z.number().int().nonnegative(),
  url: z.url(),
});
export type IncidentSummary = z.infer<typeof IncidentSummarySchema>;

export const IncidentEventSchema = z.object({
  id: z.string(),
  seq: z.number().int().positive(),
  type: IncidentEventTypeSchema,
  actor: ActorSchema.nullable(),
  body: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type IncidentEvent = z.infer<typeof IncidentEventSchema>;

export const IncidentDetailSchema = IncidentSummarySchema.extend({
  summary: z.string(),
  impact: z.string().nullable(),
  exitCondition: z.string(),
  suspect: IncidentSuspectSchema.nullable(),
  creator: ActorSchema.nullable(),
  resolutionNote: z.string().nullable(),
  mitigatedAt: z.iso.datetime().nullable(),
  affected: z.array(
    z.object({ actor: ActorSchema, joinedAt: z.iso.datetime() }),
  ),
  links: z.array(IncidentLinkSchema),
  signals: z.array(IncidentSignalStateSchema),
  timeline: z.array(IncidentEventSchema),
});
export type IncidentDetail = z.infer<typeof IncidentDetailSchema>;

// ---------------------------------------------------------------------------
// Commands (tRPC inputs). Every mutation carries the acting `actor`; every
// mutation of an existing incident carries `expectedRevision`.
// ---------------------------------------------------------------------------

const Ref = z.string().min(1).max(64); // INC-N, N, or UUID
const Note = z.string().min(1).max(20_000);

export const ListIncidentsInputSchema = z
  .object({
    state: z.enum(["open", "resolved", "all"]).default("open"),
    kind: IncidentKindSchema.optional(),
    system: IncidentSystemSchema.optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListIncidentsInput = z.input<typeof ListIncidentsInputSchema>;

export const IncidentRefInputSchema = z.object({ ref: Ref }).strict();

/**
 * `check`: the open incidents an agent is blocked by, and its relation to
 * each. `actor` is matched by key and metadata only; a check never records it.
 */
export const CheckIncidentsInputSchema = z
  .object({
    system: IncidentSystemSchema.optional(),
    actor: ActorInputSchema.optional(),
  })
  .strict();
export type CheckIncidentsInput = z.input<typeof CheckIncidentsInputSchema>;
export const IncidentRelationSchema = z.object({
  commander: z.boolean(),
  creator: z.boolean(),
  /** Session or branch matches the incident's suspect. */
  suspect: z.boolean(),
  affected: z.boolean(),
  /** `take` would succeed now without `force`. */
  canTake: z.boolean(),
});
export const CheckIncidentsResultSchema = z.object({
  checkedAt: z.iso.datetime(),
  incidents: z.array(
    z.object({
      incident: IncidentSummarySchema,
      relation: IncidentRelationSchema,
    }),
  ),
});
export type CheckIncidentsResult = z.infer<typeof CheckIncidentsResultSchema>;

export const DeclareIncidentInputSchema = z
  .object({
    actor: ActorInputSchema,
    kind: IncidentKindSchema.default("incident"),
    title: z.string().min(3).max(200),
    summary: z.string().max(20_000).default(""),
    impact: z.string().max(5000).optional(),
    severity: IncidentSeveritySchema.default("sev2"),
    systems: z.array(IncidentSystemSchema).min(1),
    components: z.array(z.string().min(1).max(100)).default([]),
    exitCondition: z.string().min(3).max(5000),
    suspect: IncidentSuspectSchema.optional(),
    links: z.array(IncidentLinkInputSchema).default([]),
    /** Take command at declaration (the declarer is fixing it). */
    takeCommand: z.boolean().default(false),
    scheduledStart: z.iso.datetime({ offset: true }).optional(),
    scheduledEnd: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type DeclareIncidentInput = z.input<typeof DeclareIncidentInputSchema>;

/** Returned with HTTP 409 / tRPC CONFLICT when an open incident already covers a system. */
export const DuplicateIncidentSchema = z.object({
  code: z.literal("duplicate-incident"),
  existing: IncidentSummarySchema,
  systems: z.array(IncidentSystemSchema),
});
export type DuplicateIncident = z.infer<typeof DuplicateIncidentSchema>;

/** CONFLICT for a stale `expectedRevision`; refetch and retry against `incident`. */
export const StaleRevisionSchema = z.object({
  code: z.literal("stale-revision"),
  expectedRevision: z.number().int().min(0),
  incident: IncidentSummarySchema,
});
/** tRPC `error.data.incident` on CONFLICT (`error.data` also carries tRPC's own fields). */
export const IncidentErrorDataSchema = z.object({
  incident: z.discriminatedUnion("code", [
    DuplicateIncidentSchema,
    StaleRevisionSchema,
  ]),
});

const Mutation = { actor: ActorInputSchema, ref: Ref };
const Revisioned = { ...Mutation, expectedRevision: z.number().int().min(0) };

export const PostUpdateInputSchema = z
  .object({ ...Revisioned, body: Note })
  .strict();
export const ChangeStatusInputSchema = z
  .object({
    ...Revisioned,
    status: IncidentStatusSchema,
    note: Note.optional(),
  })
  .strict();
export const EditIncidentInputSchema = z
  .object({
    ...Revisioned,
    title: z.string().min(3).max(200).optional(),
    summary: z.string().max(20_000).optional(),
    impact: z.string().max(5000).nullable().optional(),
    severity: IncidentSeveritySchema.optional(),
    systems: z.array(IncidentSystemSchema).min(1).optional(),
    components: z.array(z.string().min(1).max(100)).optional(),
    exitCondition: z.string().min(3).max(5000).optional(),
    suspect: IncidentSuspectSchema.nullable().optional(),
  })
  .strict();
export const AddLinkInputSchema = z
  .object({ ...Mutation, link: IncidentLinkInputSchema })
  .strict();
export const JoinInputSchema = z
  .object({ ...Mutation, note: Note.optional() })
  .strict();

/**
 * Take command. Compare-and-set: succeeds only when nobody owns it (or the
 * dispatch lease lapsed). Before `takeoverEligibleAt`, only the suspect or the
 * creator may take it unless `force` is set (recorded in the timeline).
 * `dispatch: true` takes a short lease instead of command, returning a one-time
 * token for the agent session the caller is about to spawn.
 */
export const TakeCommandInputSchema = z
  .object({
    ...Mutation,
    dispatch: z.boolean().default(false),
    force: z.boolean().default(false),
    note: Note.optional(),
  })
  .strict();
export const TakeCommandResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("owned"), incident: IncidentSummarySchema }),
  z.object({
    outcome: z.literal("dispatching"),
    incident: IncidentSummarySchema,
    dispatchToken: z.string().min(16),
    leaseExpiresAt: z.iso.datetime(),
    /** Agent provider the spawner should start (from the module's flags). */
    provider: z.string(),
  }),
  z.object({
    outcome: z.literal("taken"),
    incident: IncidentSummarySchema,
    reason: z.enum([
      "owned-by-other",
      "dispatch-in-progress",
      "not-eligible-yet",
    ]),
  }),
]);
export type TakeCommandResult = z.infer<typeof TakeCommandResultSchema>;

/** The spawned session redeems its dispatch token to become commander. */
export const ClaimDispatchInputSchema = z
  .object({ ...Mutation, dispatchToken: z.string().min(16) })
  .strict();
/** The dispatcher gives the lease back (spawn failed). */
export const ReleaseDispatchInputSchema = z
  .object({ ...Mutation, dispatchToken: z.string().min(16), reason: Note })
  .strict();
export const HandoffInputSchema = z
  .object({
    ...Revisioned,
    /** Actor key, or null to release command. */
    to: z.string().min(3).max(200).nullable(),
    note: Note.optional(),
  })
  .strict();
export const ResolveInputSchema = z
  .object({ ...Revisioned, note: Note, force: z.boolean().default(false) })
  .strict();
export const ReopenInputSchema = z
  .object({ ...Revisioned, note: Note })
  .strict();

// ---------------------------------------------------------------------------
// Signals: machine producers that auto-open, attach to, and clear incidents.
// ---------------------------------------------------------------------------

export const IncidentSignalInputSchema = z
  .object({
    source: z.enum(["alertmanager", "main-ci"]),
    key: z.string().min(1).max(300),
    firing: z.boolean(),
    system: IncidentSystemSchema,
    severity: IncidentSeveritySchema,
    title: z.string().min(3).max(200),
    summary: z.string().max(20_000).default(""),
    exitCondition: z.string().min(3).max(5000),
    observedAt: z.iso.datetime({ offset: true }),
    suspect: IncidentSuspectSchema.optional(),
    links: z.array(IncidentLinkInputSchema).default([]),
  })
  .strict();
export type IncidentSignalInput = z.input<typeof IncidentSignalInputSchema>;

/** `POST /api/incidents/internal/signals` body (Bearer OPS_INGEST_TOKEN). */
export const IncidentSignalBatchSchema = z
  .object({ signals: z.array(IncidentSignalInputSchema).min(1).max(100) })
  .strict();
export type IncidentSignalBatch = z.input<typeof IncidentSignalBatchSchema>;

/** `ignored`: a clear with nothing attached, a repeat, or auto-open disabled. */
export const IncidentSignalOutcomeSchema = z.enum([
  "opened",
  "attached",
  "updated",
  "cleared",
  "auto-resolved",
  "ignored",
]);
export type IncidentSignalOutcome = z.infer<typeof IncidentSignalOutcomeSchema>;
/** 202 body for both signal producers, one result per input signal, in order. */
export const IncidentSignalBatchResultSchema = z.object({
  results: z.array(
    z.object({
      key: z.string(),
      outcome: IncidentSignalOutcomeSchema,
      identifier: z.string().regex(INCIDENT_IDENTIFIER_PATTERN).nullable(),
    }),
  ),
});
export type IncidentSignalBatchResult = z.infer<
  typeof IncidentSignalBatchResultSchema
>;

// ---------------------------------------------------------------------------
// Live stream: `GET /api/incidents/events/stream` (text/event-stream).
// Each `incident` frame names a changed incident; clients refetch by id.
// `?incident=INC-N` limits the stream to one incident. Idle streams carry a
// `: heartbeat` comment every few seconds.
// ---------------------------------------------------------------------------

export const INCIDENT_STREAM_EVENT = "incident";

export const IncidentStreamFrameSchema = z.object({
  incidentId: z.string(),
  identifier: z.string().regex(INCIDENT_IDENTIFIER_PATTERN),
  revision: z.number().int().nonnegative(),
  type: IncidentEventTypeSchema,
  status: IncidentStatusSchema,
  commandState: CommandStateSchema,
});
export type IncidentStreamFrame = z.infer<typeof IncidentStreamFrameSchema>;
