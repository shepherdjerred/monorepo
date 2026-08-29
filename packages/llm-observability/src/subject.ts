import {
  context,
  createContextKey,
  SpanStatusCode,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { getLlmTracer } from "./span-helpers.ts";

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
 */
export function activeLlmSubject(): LlmSubject | undefined {
  const value: unknown = context.active().getValue(SUBJECT_CONTEXT_KEY);
  if (value === null || typeof value !== "object") return undefined;
  if (!("kind" in value) || !("id" in value)) return undefined;
  const { kind, id } = value;
  if (typeof id !== "string") return undefined;
  // `find` both validates the kind and yields it already narrowed to the union,
  // so no type assertion is needed to rebuild the subject.
  const matched = LLM_SUBJECT_KINDS.find((known) => known === kind);
  return matched === undefined ? undefined : { kind: matched, id };
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
  return await getLlmTracer().startActiveSpan(name, async (span) => {
    span.setAttributes(attributes);
    try {
      const result = await context.with(
        setLlmSubject(context.active(), subject),
        () => fn(span),
      );
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: unknown) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}
