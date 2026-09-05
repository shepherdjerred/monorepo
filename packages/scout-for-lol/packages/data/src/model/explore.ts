import { z } from "zod";
import { ReportQueryTextSchema } from "#src/model/report.ts";
import { VisualizationSnapshotSchema } from "#src/model/temporal-analysis.ts";
import { ReportAiPreviewSummarySchema } from "#src/model/report-ai.ts";

/**
 * Contracts for the explore surface — a conversation over the whole report
 * lake rather than one server's tracked accounts.
 *
 * Explore differs from the report AI editor in two ways that show up here.
 * It is multi-turn, so a request carries a conversation id and the server
 * rebuilds the transcript rather than trusting a client-supplied history. And
 * its answer is prose with an optional visualization attached, not a report
 * draft — the ScoutQL it ran is supporting evidence the reader can expand,
 * not the deliverable.
 */

export const EXPLORE_REQUEST_MAX_BYTES = 16 * 1024;
export const EXPLORE_QUESTION_MAX_LENGTH = 2000;
export const EXPLORE_ANSWER_MAX_LENGTH = 4000;
export const EXPLORE_MAX_STEPS = 12;
export const EXPLORE_MAX_TOOL_CALLS = 30;
export const EXPLORE_MAX_PREVIEW_CALLS = 8;
export const EXPLORE_MAX_OUTPUT_TOKENS = 4000;
export const EXPLORE_TIMEOUT_MS = 180_000;
/**
 * How many prior turns are replayed to the model. The transcript is stored in
 * full — this only bounds what one turn pays for in context.
 */
export const EXPLORE_MAX_HISTORY_TURNS = 8;
export const EXPLORE_TITLE_MAX_LENGTH = 120;
/**
 * How long an owner-only live status line may be.
 *
 * Deliberately smaller than the 500-character cap on a persisted trace
 * `message`. The two are different channels with different audiences — a trace
 * message is served publicly on a share link, an activity string never is —
 * and the asymmetry is a tripwire: a 500-character trace message cannot be
 * routed onto the activity channel without visibly truncating.
 */
export const EXPLORE_ACTIVITY_MAX_LENGTH = 200;

export const ExploreConversationTitleSchema = z
  .string()
  .trim()
  .min(1, "Enter a conversation title.")
  .max(
    EXPLORE_TITLE_MAX_LENGTH,
    `Conversation titles must be ${EXPLORE_TITLE_MAX_LENGTH.toString()} characters or fewer.`,
  );

/** Caveat written onto a turn the asker deliberately stopped. */
export const EXPLORE_STOPPED_CAVEAT =
  "This answer was stopped before it finished.";
/** Caveat written onto a turn an error interrupted mid-stream. */
export const EXPLORE_INTERRUPTED_CAVEAT =
  "This answer was interrupted by an error before it finished.";

export const ExploreConversationIdSchema = z.uuid();
export type ExploreConversationId = z.infer<typeof ExploreConversationIdSchema>;

export const ExploreRunIdSchema = z.uuid();
export type ExploreRunId = z.infer<typeof ExploreRunIdSchema>;

/**
 * Share tokens are opaque and unguessable: the share link is the only
 * credential, so the token must not be derived from the conversation id.
 */
export const ExploreShareTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/, "Share tokens are 32 lowercase hex characters.");
export type ExploreShareToken = z.infer<typeof ExploreShareTokenSchema>;

export const ExploreQuestionSchema = z
  .string()
  .trim()
  .min(1)
  .max(EXPLORE_QUESTION_MAX_LENGTH);

/**
 * Where a turn attaches in the conversation tree.
 *
 * - `leaf`: continue the branch on screen (the server resolves the current
 *   leaf).
 * - `root`: fork the opening question — a new sibling with no parent. Needed
 *   because the root's parentId IS null, so "the edited message's parent"
 *   cannot name it.
 * - `message`: attach under a specific message — an edit names the edited
 *   question's parent; a regenerate names the question to answer again.
 */
export const ExploreAttachPointSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("leaf") }).strict(),
  z.object({ kind: z.literal("root") }).strict(),
  z.object({ kind: z.literal("message"), messageId: z.uuid() }).strict(),
]);

export type ExploreAttachPoint = z.infer<typeof ExploreAttachPointSchema>;

/**
 * One request covers all four ways a turn starts.
 *
 * | Flow            | `question` | `attach`                                    |
 * | --------------- | ---------- | ------------------------------------------- |
 * | Ask             | set        | { kind: "leaf" }                            |
 * | Edit (non-root) | set        | { kind: "message", messageId: parent's id } |
 * | Edit (root)     | set        | { kind: "root" }                            |
 * | Regenerate      | null       | { kind: "message", messageId: question id } |
 *
 * A null `question` means "answer this existing user turn again", so `attach`
 * must name a user message; the server rejects anything else. A null
 * `conversationId` starts a new conversation and ignores `attach` entirely.
 */
export const ExploreTurnRequestSchema = z
  .object({
    /** Null starts a new conversation; the server mints the id. */
    conversationId: ExploreConversationIdSchema.nullable().default(null),
    question: ExploreQuestionSchema.nullable().default(null),
    attach: ExploreAttachPointSchema.default({ kind: "leaf" }),
  })
  .strict();

export type ExploreTurnRequest = z.infer<typeof ExploreTurnRequestSchema>;

/**
 * The agent's structured answer for one turn.
 *
 * `queryText` is nullable because not every turn runs a query — a follow-up
 * like "what does KDA mean here?" is answerable from the transcript. When it
 * is present it is the query the answer is actually based on.
 */
export const ExploreAnswerSchema = z
  .object({
    answer: z.string().trim().min(1).max(EXPLORE_ANSWER_MAX_LENGTH),
    /**
     * A short name for the whole conversation, used only for its first turn.
     *
     * Deliberately not first: `answer` must stay the first field or streaming
     * stops (a partial snapshot only carries the keys emitted so far), which
     * is why this is appended rather than placed where it reads best.
     *
     * Unbounded and nullable on purpose — a `max()` here would turn an
     * over-long title into a schema failure that costs the reader the whole
     * answer, because the same schema both instructs the model and parses its
     * output. `titleFromQuestion` clamps to EXPLORE_TITLE_MAX_LENGTH before
     * anything is stored or displayed, so the bound is enforced where it
     * cannot destroy the answer. The persisted and tRPC schemas below stay
     * strict — they see already-clamped titles.
     */
    title: z.string().trim().min(1).nullable().default(null),
    queryText: ReportQueryTextSchema.nullable().default(null),
    /**
     * Limits a reader needs to judge the answer — small samples, a corpus
     * that only covers matches Scout ingested, a metric that means something
     * narrower than the question implied.
     */
    caveats: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
    /** Suggested next questions, offered as chips in the UI. */
    followUps: z.array(z.string().trim().min(1).max(200)).max(3).default([]),
  })
  .strict();

export type ExploreAnswer = z.infer<typeof ExploreAnswerSchema>;

/**
 * The same answer contract, shaped for a strict structured-output request.
 *
 * The runtime asks OpenRouter for `structuredOutputs: { strict: true }`, and
 * OpenAI's strict mode requires *every* property to appear in `required` —
 * a field carrying `.default()` is emitted as optional and the provider
 * rejects the whole request with `invalid_json_schema`
 * ("'required' ... must include every key in properties"). That is a hard 400
 * on every turn, not a soft downgrade, so the defaults cannot live on the wire.
 *
 * The model must therefore supply all five keys; `title` and `queryText` stay
 * nullable because follow-ups do not rename an established conversation and
 * can be answered from the transcript without another query. Empty arrays
 * express "no caveats/follow-ups". Parse the result through
 * `ExploreAnswerSchema` to land in the domain type — the defaults there become
 * no-ops once every key is present, so the two schemas cannot drift apart in
 * what they accept.
 */
export const ExploreAnswerWireSchema = z
  .object({
    answer: z.string().trim().min(1).max(EXPLORE_ANSWER_MAX_LENGTH),
    title: z.string().trim().min(1).nullable(),
    queryText: ReportQueryTextSchema.nullable(),
    caveats: z.array(z.string().trim().min(1).max(300)).max(5),
    followUps: z.array(z.string().trim().min(1).max(200)).max(3),
  })
  .strict();

export const EXPLORE_TRACE_PAYLOAD_MAX_BYTES = 64 * 1024;
export const EXPLORE_TRACE_TOTAL_MAX_BYTES = 256 * 1024;

export const ExploreTraceStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "interrupted",
]);
export type ExploreTraceStatus = z.infer<typeof ExploreTraceStatusSchema>;

const TraceCount = z.number().int().nonnegative().nullable().optional();

/**
 * How much of the language reference a turn read.
 *
 * Every field is optional because traces are PERSISTED and rendered back for
 * conversations that already exist. ScoutQL v2 dissolved the metric, group-by
 * and filter vocabularies into columns and functions, so those three keys
 * appear only on pre-v2 traces and the v2 keys only on new ones; the panel
 * renders whichever it finds. Dropping the old keys outright would fail this
 * strict schema on every stored trace and empty the reasoning panel for them.
 */
const ExploreTraceReferenceDetailsSchema = z
  .object({
    kind: z.literal("reference"),
    sources: TraceCount,
    functions: TraceCount,
    renderKinds: TraceCount,
    renderOptions: TraceCount,
    queues: TraceCount,
    presets: TraceCount,
    // v2
    columns: TraceCount,
    aggregateFunctions: TraceCount,
    scalarFunctions: TraceCount,
    idioms: TraceCount,
    // pre-v2 only
    metrics: TraceCount,
    groupBys: TraceCount,
    filters: TraceCount,
  })
  .strict();

const ExploreTraceValidationDetailsSchema = z
  .object({
    kind: z.literal("validation"),
    queryText: ReportQueryTextSchema,
    ok: z.boolean().nullable(),
    diagnostics: z.array(z.string().max(500)).max(6),
    formattedQueryText: ReportQueryTextSchema.nullable(),
  })
  .strict();

const ExploreTraceFormatDetailsSchema = z
  .object({
    kind: z.literal("format"),
    queryText: ReportQueryTextSchema,
    formattedQueryText: ReportQueryTextSchema.nullable(),
  })
  .strict();

const ExploreTraceExecutionDetailsSchema = z
  .object({
    kind: z.literal("execution"),
    queryText: ReportQueryTextSchema,
    ok: z.boolean().nullable(),
    rowsReturned: z.number().int().nonnegative().nullable(),
    rowsScanned: z.number().int().nonnegative().nullable(),
    renderKind: z.string().nullable(),
  })
  .strict();

export const ExploreTraceDetailsSchema = z.discriminatedUnion("kind", [
  ExploreTraceReferenceDetailsSchema,
  ExploreTraceValidationDetailsSchema,
  ExploreTraceFormatDetailsSchema,
  ExploreTraceExecutionDetailsSchema,
]);
export type ExploreTraceDetails = z.infer<typeof ExploreTraceDetailsSchema>;

export const ExploreTraceRawValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("value"),
      value: z.json(),
      byteLength: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("omitted"),
      reason: z.enum(["payload_limit", "turn_limit"]),
      byteLength: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type ExploreTraceRawValue = z.infer<typeof ExploreTraceRawValueSchema>;

const RichExploreTraceEntrySchema = z
  .object({
    toolCallId: z.string().min(1).max(200),
    toolName: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
    status: ExploreTraceStatusSchema,
    durationMs: z.number().int().nonnegative().nullable(),
    details: ExploreTraceDetailsSchema.nullable(),
    rawInput: ExploreTraceRawValueSchema.nullable(),
    rawOutput: ExploreTraceRawValueSchema.nullable(),
  })
  .strict();

const LegacyExploreTraceEntrySchema = z
  .object({
    toolName: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
    ok: z.boolean(),
  })
  .strict();

/**
 * One auditable agent tool call. The legacy branch upgrades existing stored
 * traces on read; new entries always carry a provider call id and rich state.
 */
export const ExploreTraceEntrySchema = z
  .union([RichExploreTraceEntrySchema, LegacyExploreTraceEntrySchema])
  .transform((entry) =>
    "ok" in entry
      ? {
          toolCallId: `legacy-${entry.toolName}`,
          toolName: entry.toolName,
          message: entry.message,
          status: ExploreTraceStatusSchema.parse(
            entry.ok ? "succeeded" : "failed",
          ),
          durationMs: null,
          details: null,
          rawInput: null,
          rawOutput: null,
        }
      : entry,
  );

export type ExploreTraceEntry = z.infer<typeof ExploreTraceEntrySchema>;

export const ExploreMessageRoleSchema = z.enum(["user", "assistant"]);
export type ExploreMessageRole = z.infer<typeof ExploreMessageRoleSchema>;

/**
 * One persisted turn. Assistant messages keep the rendered result inline, so
 * a frozen share needs no re-execution and never drifts from what the asker
 * actually saw.
 */
export const ExploreMessageSchema = z
  .object({
    id: z.uuid(),
    role: ExploreMessageRoleSchema,
    /** Null for the opening message. Siblings under a parent are versions. */
    parentId: z.uuid().nullable().default(null),
    /**
     * Every version of this turn, oldest first — the order the arrows page
     * through. Computed server-side so switching needs no extra round trip,
     * and carrying the ids rather than just a count is what lets the UI say
     * *which* message "previous" means.
     */
    siblingIds: z.array(z.uuid()).default([]),
    /** Position within {@link siblingIds}, and its length. Derived together. */
    versionIndex: z.number().int().nonnegative().default(0),
    versionCount: z.number().int().positive().default(1),
    content: z.string(),
    queryText: ReportQueryTextSchema.nullable().default(null),
    caveats: z.array(z.string()).default([]),
    followUps: z.array(z.string()).default([]),
    preview: ReportAiPreviewSummarySchema.nullable().default(null),
    visualization: VisualizationSnapshotSchema.nullable().default(null),
    trace: z.array(ExploreTraceEntrySchema).default([]),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type ExploreMessage = z.infer<typeof ExploreMessageSchema>;

export const ExploreConversationSchema = z
  .object({
    id: ExploreConversationIdSchema,
    title: ExploreConversationTitleSchema,
    shareToken: ExploreShareTokenSchema.nullable().default(null),
    /** The leaf a share link is pinned to, if the conversation is shared. */
    sharedLeafId: z.uuid().nullable().default(null),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type ExploreConversation = z.infer<typeof ExploreConversationSchema>;

export const ExploreTranscriptSchema = z
  .object({
    conversation: ExploreConversationSchema,
    messages: z.array(ExploreMessageSchema),
  })
  .strict();

export type ExploreTranscript = z.infer<typeof ExploreTranscriptSchema>;

export const ExploreQuotaScopeSchema = z.enum(["user", "global"]);
export type ExploreQuotaScope = z.infer<typeof ExploreQuotaScopeSchema>;

export const ExploreQuotaWindowSchema = z.enum([
  "minute",
  "hour",
  "day",
  "week",
]);
export type ExploreQuotaWindow = z.infer<typeof ExploreQuotaWindowSchema>;

export const ExploreQuotaSnapshotSchema = z
  .object({
    scope: ExploreQuotaScopeSchema,
    window: ExploreQuotaWindowSchema,
    used: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    remaining: z.number().int().nonnegative(),
    resetsAt: z.iso.datetime(),
  })
  .strict();

export type ExploreQuotaSnapshot = z.infer<typeof ExploreQuotaSnapshotSchema>;

/** The stable identity returned when the backend starts or lists a live run. */
export const ExploreActiveRunSchema = z
  .object({
    runId: ExploreRunIdSchema,
    conversationId: ExploreConversationIdSchema,
    questionMessageId: z.uuid(),
    /** The branch leaf visible when this run began, for reconnect-safe version detection. */
    leafIdAtStart: z.uuid().nullable(),
    versionCountAtStart: z.number().int().nonnegative().default(0),
    startedAt: z.iso.datetime(),
  })
  .strict();

export type ExploreActiveRun = z.infer<typeof ExploreActiveRunSchema>;

export const ExploreRunOutcomeSchema = z.enum([
  "succeeded",
  "failed",
  "stopped",
  "interrupted",
]);
export type ExploreRunOutcome = z.infer<typeof ExploreRunOutcomeSchema>;

/** Attach an authenticated observer to a server-owned run. */
export const ExploreRunObserveRequestSchema = z
  .object({ runId: ExploreRunIdSchema })
  .strict();

export type ExploreRunObserveRequest = z.infer<
  typeof ExploreRunObserveRequestSchema
>;

export const ExploreRunOutcomeResultSchema = z
  .object({ outcome: ExploreRunOutcomeSchema.nullable() })
  .strict();
export type ExploreRunOutcomeResult = z.infer<
  typeof ExploreRunOutcomeResultSchema
>;

/**
 * Complete replaceable state sent whenever an observer attaches.
 *
 * Replacing from a snapshot before applying later deltas makes reconnects
 * idempotent: a lost response can be observed again without appending the
 * same answer fragment or tool result twice.
 */
export const ExploreRunSnapshotEventSchema = z
  .object({
    type: z.literal("snapshot"),
    runId: ExploreRunIdSchema,
    conversationId: ExploreConversationIdSchema,
    questionMessageId: z.uuid(),
    leafIdAtStart: z.uuid().nullable(),
    versionCountAtStart: z.number().int().nonnegative().default(0),
    startedAt: z.iso.datetime(),
    answer: z.string().max(EXPLORE_ANSWER_MAX_LENGTH).nullable(),
    activity: z.string().trim().min(1).max(500).nullable(),
    trace: z.array(ExploreTraceEntrySchema),
  })
  .strict();

/**
 * The newest query result, sent straight after a snapshot on reconnect.
 *
 * A separate member rather than a field on the snapshot, and this is a
 * compatibility requirement rather than a preference. A browser keeps its
 * bundle for as long as the tab stays open, and every bundle already shipped
 * parses `ExploreRunSnapshotEventSchema` as `.strict()` — so an added key
 * makes the snapshot itself unparseable there. The reader treats that as a
 * corrupted stream and reconnects, receives the same rejected snapshot, and
 * the turn stops updating for the rest of its life.
 *
 * Marked ignorable because it is: a client that skips it renders the table a
 * beat later, when the next `preview` or `final` arrives, rather than
 * rendering something wrong.
 *
 * Carries no visualization, matching the snapshot's own economy: a
 * `VisualizationSnapshot` permits eight series totalling two thousand points
 * and the durable observer re-sends this roughly once a second, while this
 * summary is hard-bounded at 20 columns by 22 rows.
 */
export const ExploreRunPreviewEventSchema = z
  .object({
    type: z.literal("run_preview"),
    preview: ReportAiPreviewSummarySchema.nullable(),
    ignorable: z.literal(true).default(true),
  })
  .strict();

export const ExploreStreamEventSchema = z.discriminatedUnion("type", [
  ExploreRunSnapshotEventSchema,
  ExploreRunPreviewEventSchema,
  z
    .object({
      type: z.literal("started"),
      runId: z.uuid(),
      conversationId: ExploreConversationIdSchema,
      /**
       * The user message this turn answers: the freshly persisted question
       * for ask/edit, the existing question for a regenerate. Lets the client
       * stop rendering its optimistic copy the moment a refetch contains this
       * id, and recognise a salvaged partial answer after a stop.
       */
      questionMessageId: z.uuid(),
    })
    .strict(),
  /**
   * Owner-only narration of what the turn is doing right now.
   *
   * A separate member rather than a field on `tool_call`/`tool_result`, for
   * three reasons. It has to narrate moments where no tool call exists yet —
   * the model has named a tool but not finished its arguments — and moments
   * with no tool at all, such as writing the answer. It keeps the specific
   * text structurally out of the trace: `recordExploreTraceEvent` matches only
   * tool members, and `ExploreTraceEntrySchema` is `.strict()` with no such
   * field, so this cannot reach a trace entry even by accident. And it keeps
   * the concern separate in the client reducer, where status and timeline used
   * to be updated on adjacent lines of the same branch.
   *
   * Nothing here is persisted, and nothing here reaches a share link. That is
   * what lets it name a player or a row count while the trace message stays as
   * generic as the anonymous audience requires.
   */
  z
    .object({
      type: z.literal("activity"),
      text: z.string().trim().min(1).max(EXPLORE_ACTIVITY_MAX_LENGTH),
      /** The provider call this narrates, when there is one. */
      toolCallId: z.string().trim().min(1).max(200).nullable().default(null),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_call"),
      toolCallId: z.string().trim().min(1).max(200),
      toolName: z.string().trim().min(1).max(100),
      message: z.string().trim().min(1).max(500),
      details: ExploreTraceDetailsSchema.nullable(),
      rawInput: ExploreTraceRawValueSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_result"),
      toolCallId: z.string().trim().min(1).max(200),
      toolName: z.string().trim().min(1).max(100),
      status: z.enum(["succeeded", "failed"]),
      message: z.string().trim().min(1).max(500),
      durationMs: z.number().int().nonnegative().nullable(),
      details: ExploreTraceDetailsSchema.nullable(),
      rawOutput: ExploreTraceRawValueSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("preview"),
      preview: ReportAiPreviewSummarySchema,
      visualization: VisualizationSnapshotSchema.nullable().default(null),
    })
    .strict(),
  z
    .object({
      type: z.literal("answer_delta"),
      text: z.string().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      type: z.literal("final"),
      message: ExploreMessageSchema,
      title: ExploreConversationTitleSchema,
      quota: z.array(ExploreQuotaSnapshotSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      message: z.string().trim().min(1).max(1000),
      retryAfterSeconds: z.number().int().positive().nullable().default(null),
      quota: z.array(ExploreQuotaSnapshotSchema).nullable().default(null),
    })
    .strict(),
  z
    .object({
      type: z.literal("done"),
      outcome: ExploreRunOutcomeSchema,
    })
    .strict(),
]);

export type ExploreStreamEvent = z.infer<typeof ExploreStreamEventSchema>;

/**
 * Every discriminator the union currently knows, derived from the union
 * itself so the two cannot drift.
 */
const KNOWN_EXPLORE_STREAM_EVENT_TYPES: ReadonlySet<string> = new Set(
  ExploreStreamEventSchema.options.map((option) => option.shape.type.value),
);

/**
 * Just enough of a frame to tell "a newer server sent something optional" from
 * "this payload is corrupt".
 *
 * `ignorable` is the marker a new event uses to say an old client may drop it
 * and still render a correct transcript. It is opt-in on purpose: an unknown
 * discriminator alone proves only that the sender is newer, not that what it
 * sent was unimportant, and silently discarding an event whose semantics the
 * transcript depended on would leave the page quietly wrong instead of
 * visibly broken.
 */
const ExploreStreamEnvelopeSchema = z.looseObject({
  type: z.string(),
  ignorable: z.boolean().optional(),
});

/**
 * Parse one stream frame, tolerating a member this bundle has never heard of
 * **only when that member said it was safe to skip**.
 *
 * A browser tab keeps its bundle for as long as it stays open, so a deploy
 * that adds a stream event reaches tabs whose parser predates it. The union is
 * `.strict()` and the SSE reader treats a parse failure as a corrupted stream,
 * so without any tolerance an open tab would die mid-turn — showing a
 * corruption error for a turn the server answered perfectly well.
 *
 * So the tolerance exists, but it is granted by the sender rather than assumed
 * by the reader: an unrecognised discriminator is skipped only if the frame
 * carries `ignorable: true`. Everything else still throws — a known type in
 * the wrong shape is real corruption, and an unknown type that did not
 * volunteer to be skippable is a client too old to render this turn honestly.
 * Both belong on the corrupted-stream path, which reconnects.
 */
export function parseExploreStreamEvent(
  raw: unknown,
): ExploreStreamEvent | null {
  const parsed = ExploreStreamEventSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  const envelope = ExploreStreamEnvelopeSchema.safeParse(raw);
  if (
    envelope.success &&
    envelope.data.ignorable === true &&
    !KNOWN_EXPLORE_STREAM_EVENT_TYPES.has(envelope.data.type)
  ) {
    return null;
  }
  throw parsed.error;
}

export const ExploreHttpErrorSchema = z
  .object({
    error: z.string().trim().min(1).max(1000),
    retryAfterSeconds: z.number().int().positive().nullable().default(null),
    quota: z.array(ExploreQuotaSnapshotSchema).nullable().default(null),
  })
  .strict();

export type ExploreHttpError = z.infer<typeof ExploreHttpErrorSchema>;
