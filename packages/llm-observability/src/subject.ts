import {
  context,
  createContextKey,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { z } from "zod";
import { getLlmTracer, runSpanLifecycle } from "./span-helpers.ts";

/**
 * Who or what an LLM call was made on behalf of.
 *
 * Not every workload has a requester. Scout's most expensive workload generates
 * match reports for a tracked player nobody explicitly asked on behalf of, and
 * the betting workloads run on a schedule for a whole guild. Modelling this as a
 * bare user id would force those callers to either lie or opt out, so the kind
 * travels with the id.
 */
export const LLM_SUBJECT_KINDS = [
  "discord_user",
  "guild",
  "tracked_player",
  "system",
] as const;

export type LlmSubjectKind = (typeof LLM_SUBJECT_KINDS)[number];

export type LlmSubject = {
  kind: LlmSubjectKind;
  id: string;
};

export const LLM_SUBJECT_KIND_ATTRIBUTE = "llm.subject.kind";
export const LLM_SUBJECT_ID_ATTRIBUTE = "llm.subject.id";

/**
 * Build the span attributes for a subject.
 *
 * These are span attributes and must never become Prometheus labels. Subject ids
 * are unbounded — Discord snowflakes, PUUIDs — and the LLM metrics deliberately
 * carry only bounded service/workload/provider/model/outcome labels. Tempo is
 * already the store for trace, session, and user ids.
 */
export function llmSubjectAttributes(
  subject: LlmSubject,
): Record<string, string> {
  if (subject.id.trim() === "") {
    // A blank id silently produces a span that looks attributed but groups
    // every caller under one empty key, which is worse than no attribution:
    // the resulting per-subject panel reads as a single dominant user.
    throw new Error(
      `LLM subject of kind "${subject.kind}" requires a non-empty id`,
    );
  }
  return {
    [LLM_SUBJECT_KIND_ATTRIBUTE]: subject.kind,
    [LLM_SUBJECT_ID_ATTRIBUTE]: subject.id,
  };
}

const SUBJECT_CONTEXT_KEY = createContextKey("shepherdjerred.llm.subject");

const LlmSubjectContextValueSchema = z.object({
  kind: z.enum(LLM_SUBJECT_KINDS),
  id: z.string(),
});

/** Attach `subject` to `ctx` so nested model calls can find it. */
export function setLlmSubject(ctx: Context, subject: LlmSubject): Context {
  return ctx.setValue(SUBJECT_CONTEXT_KEY, subject);
}

/**
 * The subject of the innermost enclosing `withLlmSubjectSpan`, if any.
 *
 * This exists because OpenTelemetry span attributes are **not** inherited.
 * Usage lands on the `gen_ai.*` spans the AI SDK creates, several levels below
 * the attribution span, so a query that groups by subject and sums tokens finds
 * the two on different spans and returns nothing. Propagating through context
 * lets the telemetry layer stamp the subject onto the same span that carries
 * the usage, which is what makes per-subject token and cost queries answerable
 * at all.
 *
 * `undefined` from the context key never having been set is a legitimate,
 * common case: most calls open no attribution span. A *present* value that
 * fails to parse is not that -- it is a broken `setLlmSubject` caller, a
 * contract violation between two pieces of our own code with no external
 * boundary between them, and `.parse()` lets it fail loudly rather than
 * silently rendering as unattributed.
 */
export function activeLlmSubject(): LlmSubject | undefined {
  const value = context.active().getValue(SUBJECT_CONTEXT_KEY);
  if (value === undefined) return undefined;
  return LlmSubjectContextValueSchema.parse(value);
}

/**
 * Subject attributes for the active subject, or an empty object when there is
 * none. Safe to spread into any span's attributes.
 */
export function activeLlmSubjectAttributes(): Record<string, string> {
  const subject = activeLlmSubject();
  return subject === undefined ? {} : llmSubjectAttributes(subject);
}

/**
 * Open an active span carrying the subject and run `fn` inside it.
 *
 * The span must be *active*, not merely created: `@shepherdjerred/llm-runtime`
 * reads `trace.getSpan(context.active())` when it builds a call's attribution
 * headers, so a call made outside an active span reaches OpenRouter with no
 * trace id and its cost log cannot be joined back to the trace that names the
 * subject. Wrapping the call site is what makes both work.
 */
export async function withLlmSubjectSpan<T>(
  name: string,
  subject: LlmSubject,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const attributes = llmSubjectAttributes(subject);
  return await getLlmTracer().startActiveSpan(name, (span) => {
    span.setAttributes(attributes);
    return context.with(setLlmSubject(context.active(), subject), () =>
      runSpanLifecycle(span, fn),
    );
  });
}
