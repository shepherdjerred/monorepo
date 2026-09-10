import { z } from "zod";
import { ReportQueryTextSchema } from "#src/model/reports/report.ts";
import { ExploreMatchCardRequestsSchema } from "#src/model/reports/explore-match-card.ts";

export const EXPLORE_ANSWER_MAX_LENGTH = 4000;

const INCLUDE_VISUALIZATION_DESCRIPTION =
  "True only when a chart or table should be attached to this turn. False when the prose is enough, no query ran, or a table would dump the same numbers already in the answer.";

const ExploreFollowUpSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe(
    "Follow-up questions the user can ask next. Phrased from the user's perspective (e.g. 'Show win rates for ADC'), never as the bot asking the user.",
  );

/**
 * The agent's structured answer for one turn.
 *
 * `queryText` is nullable because not every turn runs a query — a follow-up
 * like "what does KDA mean here?" is answerable from the transcript. When it
 * is present it is the query the answer is actually based on.
 *
 * `includeVisualization` is the agent's decision to attach that query's chart
 * or table. Running a query is not enough; the ScoutQL stays on `queryText`
 * as collapsed evidence either way.
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
     * Whether to attach the last query's chart or table to this turn.
     *
     * Default false so a missing key — tests, a salvaged partial, an older
     * stored answer parsed through this schema — does not invent a
     * visualization the agent never chose.
     */
    includeVisualization: z
      .boolean()
      .describe(INCLUDE_VISUALIZATION_DESCRIPTION)
      .default(false),
    /** Source-backed match artifacts the model wants beside this answer. */
    matchCards: ExploreMatchCardRequestsSchema.default([]),
    /**
     * Limits a reader needs to judge the answer — small samples, a corpus
     * that only covers matches Scout ingested, a metric that means something
     * narrower than the question implied.
     */
    caveats: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
    /** Suggested next questions, offered as chips in the UI. */
    followUps: z.array(ExploreFollowUpSchema).max(3).default([]),
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
 * The model must therefore supply all six keys; `title` and `queryText` stay
 * nullable because follow-ups do not rename an established conversation and
 * can be answered from the transcript without another query. Empty arrays
 * express "no caveats/follow-ups". `includeVisualization` is a required
 * boolean — false is the correct value when the prose is the whole answer.
 * Parse the result through `ExploreAnswerSchema` to land in the domain type
 * — the defaults there become no-ops once every key is present, so the two
 * schemas cannot drift apart in what they accept.
 */
export const ExploreAnswerWireSchema = z
  .object({
    answer: z.string().trim().min(1).max(EXPLORE_ANSWER_MAX_LENGTH),
    title: z.string().trim().min(1).nullable(),
    queryText: ReportQueryTextSchema.nullable(),
    includeVisualization: z
      .boolean()
      .describe(INCLUDE_VISUALIZATION_DESCRIPTION),
    matchCards: ExploreMatchCardRequestsSchema,
    caveats: z.array(z.string().trim().min(1).max(300)).max(5),
    followUps: z.array(ExploreFollowUpSchema).max(3),
  })
  .strict();
