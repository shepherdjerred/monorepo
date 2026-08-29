import { expect, test } from "vitest";
import { RepositoryOpenTelemetry } from "#src/ai-sdk-telemetry.ts";
import {
  LLM_SUBJECT_ID_ATTRIBUTE,
  LLM_SUBJECT_KIND_ATTRIBUTE,
  withLlmSubjectSpan,
} from "#src/subject.ts";
import { exporter } from "./otel-test-provider.ts";

test("AI SDK spans are children of a repository-owned GenAI parent", () => {
  exporter.reset();
  const telemetry = new RepositoryOpenTelemetry({
    service: "test-service",
    embedding: true,
  });

  telemetry.onStart({
    callId: "call-1",
    operationId: "ai.embed",
    provider: "openrouter.embedding",
    modelId: "openai/text-embedding-3-small",
    value: "hello",
    maxRetries: 2,
    headers: undefined,
    providerOptions: undefined,
    functionId: "test.embedding",
    recordInputs: true,
    recordOutputs: true,
  });
  telemetry.onEmbedStart({
    callId: "call-1",
    embedCallId: "embed-1",
    operationId: "ai.embed.doEmbed",
    provider: "openrouter.embedding",
    modelId: "openai/text-embedding-3-small",
    values: ["hello"],
  });
  telemetry.onEmbedEnd({
    callId: "call-1",
    embedCallId: "embed-1",
    operationId: "ai.embed.doEmbed",
    provider: "openrouter.embedding",
    modelId: "openai/text-embedding-3-small",
    values: ["hello"],
    embeddings: [[0.1, 0.2]],
    usage: { tokens: 1 },
  });
  telemetry.onEnd({
    callId: "call-1",
    operationId: "ai.embed",
    provider: "openrouter.embedding",
    modelId: "openai/text-embedding-3-small",
    value: "hello",
    embedding: [0.1, 0.2],
    usage: { tokens: 1 },
    warnings: [],
    providerMetadata: undefined,
    response: undefined,
  });

  const spans = exporter.getFinishedSpans();
  const parent = spans.find((span) => span.name === "gen_ai.embeddings");
  const sdkOperation = spans.find(
    (span) =>
      span.name === "embeddings openai/text-embedding-3-small" &&
      span.parentSpanContext?.spanId === parent?.spanContext().spanId,
  );
  expect(parent).toBeDefined();
  expect(sdkOperation).toBeDefined();
  expect(parent?.attributes["gen_ai.request.model"]).toBe(
    "text-embedding-3-small",
  );
  expect(parent?.attributes["llm.call_site"]).toBe("test.embedding");
  expect(sdkOperation?.parentSpanContext?.spanId).toBe(
    parent?.spanContext().spanId,
  );
});

test("the active subject lands on the span that carries usage", async () => {
  exporter.reset();
  const telemetry = new RepositoryOpenTelemetry({
    service: "scout-backend",
    embedding: true,
  });

  // OpenTelemetry does not propagate attributes down a trace, so a subject set
  // only on an outer span and usage recorded only on the inner gen_ai span can
  // never be summed together by one query. The subject has to be stamped onto
  // the same span as the usage, which is what this asserts.
  await withLlmSubjectSpan(
    "scout.bucks-ask",
    { kind: "discord_user", id: "160509172704739328" },
    () => {
      telemetry.onStart({
        callId: "call-subject",
        operationId: "ai.embed",
        provider: "openrouter.embedding",
        modelId: "openai/text-embedding-3-small",
        value: "hello",
        maxRetries: 2,
        headers: undefined,
        providerOptions: undefined,
        functionId: "scout.bucks-ask",
        recordInputs: true,
        recordOutputs: true,
      });
      telemetry.onEmbedStart({
        callId: "call-subject",
        embedCallId: "embed-subject",
        operationId: "ai.embed.doEmbed",
        provider: "openrouter.embedding",
        modelId: "openai/text-embedding-3-small",
        values: ["hello"],
      });
      telemetry.onEmbedEnd({
        callId: "call-subject",
        embedCallId: "embed-subject",
        operationId: "ai.embed.doEmbed",
        provider: "openrouter.embedding",
        modelId: "openai/text-embedding-3-small",
        values: ["hello"],
        embeddings: [[0.1, 0.2]],
        usage: { tokens: 1 },
      });
      telemetry.onEnd({
        callId: "call-subject",
        operationId: "ai.embed",
        provider: "openrouter.embedding",
        modelId: "openai/text-embedding-3-small",
        value: "hello",
        embedding: [0.1, 0.2],
        usage: { tokens: 1 },
        warnings: [],
        providerMetadata: undefined,
        response: undefined,
      });
      return Promise.resolve();
    },
  );

  const spans = exporter.getFinishedSpans();
  const genAi = spans.find((span) => span.name === "gen_ai.embeddings");
  // The base class's own descendant span is where usage actually lands, not
  // the repository-owned wrapper selected above -- and not necessarily its
  // direct child either: an embed operation nests an operation-level span
  // between the wrapper and the per-value embed span that carries
  // gen_ai.usage.*. Selecting on that property, rather than assuming a
  // particular depth, is what the bug this guards against actually requires: a
  // query grouping by subject and summing usage needs both on the same span,
  // wherever in the hierarchy that span sits.
  const sdkOperation = spans.find(
    (span) => span.attributes["gen_ai.usage.input_tokens"] !== undefined,
  );
  expect(sdkOperation).toBeDefined();
  expect(sdkOperation?.name).not.toBe("gen_ai.embeddings");
  expect(sdkOperation?.attributes["gen_ai.usage.input_tokens"]).toBe(1);
  expect(sdkOperation?.attributes[LLM_SUBJECT_KIND_ATTRIBUTE]).toBe(
    "discord_user",
  );
  expect(sdkOperation?.attributes[LLM_SUBJECT_ID_ATTRIBUTE]).toBe(
    "160509172704739328",
  );

  // The wrapper span carries the subject too, for queries keyed on span name
  // rather than gen_ai.usage.*, and the feature dimension survives alongside
  // it so one query can group by both what was called and who for.
  expect(genAi?.attributes[LLM_SUBJECT_KIND_ATTRIBUTE]).toBe("discord_user");
  expect(genAi?.attributes[LLM_SUBJECT_ID_ATTRIBUTE]).toBe(
    "160509172704739328",
  );
  expect(genAi?.attributes["llm.call_site"]).toBe("scout.bucks-ask");
});

test("a call with no enclosing subject span carries no subject attributes", () => {
  exporter.reset();
  const telemetry = new RepositoryOpenTelemetry({
    service: "temporal",
    embedding: true,
  });

  // Unattributed work must stay visibly unattributed rather than inheriting a
  // stale subject from whatever ran before it on the same context.
  telemetry.onStart({
    callId: "call-none",
    operationId: "ai.embed",
    provider: "openrouter.embedding",
    modelId: "openai/text-embedding-3-small",
    value: "hello",
    maxRetries: 2,
    headers: undefined,
    providerOptions: undefined,
    functionId: "homelab-audit-synthesis",
    recordInputs: true,
    recordOutputs: true,
  });
  telemetry.onEnd({
    callId: "call-none",
    operationId: "ai.embed",
    provider: "openrouter.embedding",
    modelId: "openai/text-embedding-3-small",
    value: "hello",
    embedding: [0.1, 0.2],
    usage: { tokens: 1 },
    warnings: [],
    providerMetadata: undefined,
    response: undefined,
  });

  const genAi = exporter
    .getFinishedSpans()
    .find((span) => span.name === "gen_ai.embeddings");
  expect(genAi).toBeDefined();
  expect(genAi?.attributes[LLM_SUBJECT_KIND_ATTRIBUTE]).toBeUndefined();
  expect(genAi?.attributes[LLM_SUBJECT_ID_ATTRIBUTE]).toBeUndefined();
});
