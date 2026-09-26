import { generateImage, wrapImageModel, type ImageModel } from "ai";
import { Registry } from "prom-client";
import { describe, expect, test } from "vitest";
import { imageMetricsMiddleware, runtimeMetrics } from "#src/metrics.ts";
import type { LlmRuntimeLogRecord } from "#src/types.ts";

const MODEL_ID = "gemini-3-pro-image-preview";

type ImageModelV4 = Extract<ImageModel, { specificationVersion: "v4" }>;

function imageModel(doGenerate: ImageModelV4["doGenerate"]): ImageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "google.generative-ai",
    modelId: MODEL_ID,
    maxImagesPerCall: 2,
    doGenerate,
  };
}

function successfulImageResponse(): Awaited<
  ReturnType<ImageModelV4["doGenerate"]>
> {
  return {
    images: [new Uint8Array([1]), new Uint8Array([2])],
    warnings: [],
    response: {
      timestamp: new Date("2026-09-26T00:00:00Z"),
      modelId: MODEL_ID,
      headers: undefined,
    },
    usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
  };
}

function instrumentedModel(input: {
  registry: Registry;
  logger: (record: LlmRuntimeLogRecord) => void;
  doGenerate: ImageModelV4["doGenerate"];
}): ImageModelV4 {
  return wrapImageModel({
    model: imageModel(input.doGenerate),
    middleware: imageMetricsMiddleware({
      metrics: runtimeMetrics(input.registry),
      service: "runtime-test",
      workload: "test.image",
      modelId: MODEL_ID,
      logger: input.logger,
      traceId: undefined,
    }),
  });
}

describe("image metrics", () => {
  test("records requests, usage, and catalog cost for generated images", async () => {
    const registry = new Registry();
    const records: LlmRuntimeLogRecord[] = [];
    const model = instrumentedModel({
      registry,
      logger: (record) => records.push(record),
      doGenerate: async () => successfulImageResponse(),
    });

    const result = await generateImage({
      model,
      prompt: "two test images",
      n: 2,
    });

    expect(result.images).toHaveLength(2);
    const metrics = await registry.metrics();
    expect(metrics).toContain(
      'llm_requests_total{service="runtime-test",workload="test.image",provider="google",model="gemini-3-pro-image-preview",outcome="success"} 1',
    );
    expect(metrics).toContain(
      'llm_cost_usd_total{service="runtime-test",workload="test.image",provider="google",model="gemini-3-pro-image-preview",type="catalog"} 0.268',
    );
    expect(metrics).toContain(
      'llm_tokens_total{service="runtime-test",workload="test.image",provider="google",model="gemini-3-pro-image-preview",type="output"} 5',
    );
    expect(records).toMatchObject([
      {
        event: "llm.provider.response",
        provider: "google",
        model: MODEL_ID,
        catalogCostUsd: 0.268,
      },
    ]);
  });

  test("records a failed image request without counting cost", async () => {
    const registry = new Registry();
    const records: LlmRuntimeLogRecord[] = [];
    const model = instrumentedModel({
      registry,
      logger: (record) => records.push(record),
      doGenerate: async () => {
        throw new Error("provider unavailable");
      },
    });

    await expect(
      generateImage({ model, prompt: "test image" }),
    ).rejects.toThrow("provider unavailable");

    const metrics = await registry.metrics();
    expect(metrics).toContain(
      'llm_requests_total{service="runtime-test",workload="test.image",provider="google",model="gemini-3-pro-image-preview",outcome="error"} 1',
    );
    expect(metrics).not.toContain("llm_cost_usd_total{");
    expect(records).toMatchObject([
      {
        event: "llm.provider.call_failed",
        provider: "google",
        model: MODEL_ID,
      },
    ]);
  });
});
