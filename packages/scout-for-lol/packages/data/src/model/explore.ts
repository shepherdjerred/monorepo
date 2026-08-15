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

/** Caveat written onto a turn the asker deliberately stopped. */
export const EXPLORE_STOPPED_CAVEAT =
  "This answer was stopped before it finished.";
/** Caveat written onto a turn an error interrupted mid-stream. */
export const EXPLORE_INTERRUPTED_CAVEAT =
  "This answer was interrupted by an error before it finished.";

export const ExploreConversationIdSchema = z.uuid();
export type ExploreConversationId = z.infer<typeof ExploreConversationIdSchema>;

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
 * One step the agent took, kept so a reader can audit how an answer was
 * reached rather than taking the prose on trust.
 */
export const ExploreTraceEntrySchema = z
  .object({
    toolName: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
    ok: z.boolean(),
  })
  .strict();

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
    title: z.string().trim().min(1).max(EXPLORE_TITLE_MAX_LENGTH),
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

export const ExploreStreamEventSchema = z.discriminatedUnion("type", [
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
  z
    .object({
      type: z.literal("tool_call"),
      toolName: z.string().trim().min(1).max(100),
      message: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_result"),
      toolName: z.string().trim().min(1).max(100),
      ok: z.boolean(),
      message: z.string().trim().min(1).max(500),
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
      title: z.string().trim().min(1).max(EXPLORE_TITLE_MAX_LENGTH),
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
  z.object({ type: z.literal("done") }).strict(),
]);

export type ExploreStreamEvent = z.infer<typeof ExploreStreamEventSchema>;

export const ExploreHttpErrorSchema = z
  .object({
    error: z.string().trim().min(1).max(1000),
    retryAfterSeconds: z.number().int().positive().nullable().default(null),
    quota: z.array(ExploreQuotaSnapshotSchema).nullable().default(null),
  })
  .strict();

export type ExploreHttpError = z.infer<typeof ExploreHttpErrorSchema>;
