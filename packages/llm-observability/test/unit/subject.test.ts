import { context, trace } from "@opentelemetry/api";
import { expect, test } from "vitest";
import {
  LLM_SUBJECT_ID_ATTRIBUTE,
  LLM_SUBJECT_KIND_ATTRIBUTE,
  llmSubjectAttributes,
  withLlmSubjectSpan,
} from "#src/subject.ts";
import { exporter } from "./otel-test-provider.ts";

test("withLlmSubjectSpan records the subject on the span", async () => {
  exporter.reset();

  await withLlmSubjectSpan(
    "scout.bucks-ask",
    { kind: "discord_user", id: "160509172704739328" },
    () => Promise.resolve("answered"),
  );

  const spans = exporter.getFinishedSpans();
  expect(spans.length).toBe(1);
  expect(spans[0]?.name).toBe("scout.bucks-ask");
  expect(spans[0]?.attributes[LLM_SUBJECT_KIND_ATTRIBUTE]).toBe("discord_user");
  expect(spans[0]?.attributes[LLM_SUBJECT_ID_ATTRIBUTE]).toBe(
    "160509172704739328",
  );
});

test("withLlmSubjectSpan makes the span active for the wrapped call", async () => {
  exporter.reset();

  // This is the property the whole attribution scheme rests on: llm-runtime
  // reads trace.getSpan(context.active()) to build a call's attribution
  // headers. If the span were created but not activated, the call would reach
  // OpenRouter with no trace id and its cost log could never be joined back to
  // the span naming the subject.
  const observed = await withLlmSubjectSpan(
    "scout.explore",
    { kind: "discord_user", id: "42" },
    () => Promise.resolve(trace.getSpan(context.active())?.spanContext()),
  );

  expect(observed?.traceId).toBeDefined();
  expect(observed?.spanId).toBe(
    exporter.getFinishedSpans()[0]?.spanContext().spanId,
  );
});

test("withLlmSubjectSpan records a failure and still ends the span", async () => {
  exporter.reset();

  await expect(
    withLlmSubjectSpan("scout.explore", { kind: "guild", id: "7" }, () =>
      Promise.reject(new Error("model refused")),
    ),
  ).rejects.toThrow("model refused");

  const spans = exporter.getFinishedSpans();
  expect(spans.length).toBe(1);
  expect(spans[0]?.status.code).toBe(2);
  expect(spans[0]?.events.map((event) => event.name)).toContain("exception");
});

test("a blank subject id is rejected rather than attributed to an empty key", () => {
  // A blank id would group every caller under one key, producing a per-subject
  // panel with a single dominant "user" that does not exist.
  expect(() =>
    llmSubjectAttributes({ kind: "discord_user", id: "  " }),
  ).toThrow(/requires a non-empty id/);
});

test("system is a first-class subject kind for workloads with no requester", () => {
  // Scheduled work must be able to say so honestly instead of inventing a user.
  expect(
    llmSubjectAttributes({ kind: "system", id: "scout.betting.parlay" }),
  ).toEqual({
    [LLM_SUBJECT_KIND_ATTRIBUTE]: "system",
    [LLM_SUBJECT_ID_ATTRIBUTE]: "scout.betting.parlay",
  });
});
