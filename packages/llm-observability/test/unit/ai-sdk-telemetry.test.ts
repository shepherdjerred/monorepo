import { expect, test } from "bun:test";
import { RepositoryOpenTelemetry } from "#src/ai-sdk-telemetry.ts";
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
