import { SpanStatusCode, type Span } from "@opentelemetry/api";
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
      const result = await fn(span);
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
