import { expect, test } from "vitest";
import { Registry } from "prom-client";
import { z } from "zod";
import {
  createAttributedFetch,
  type AttributedResponseObservation,
} from "#src/attributed-fetch.ts";
import { recordRouterResponse, runtimeMetrics } from "#src/metrics.ts";

const ObservationSchema = z.object({
  requestedModel: z.string(),
  responseBody: z.object({
    openrouter_metadata: z.object({
      requested: z.string(),
      attempts: z.array(z.object({ provider: z.string() }).loose()),
    }),
  }),
  responseStatus: z.number(),
  workload: z.string(),
  endpoint: z.enum(["language", "embedding", "image", "unknown"]),
  durationMs: z.number().nonnegative(),
});

async function waitForObservation(
  observations: AttributedResponseObservation[],
): Promise<AttributedResponseObservation> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const observation = observations[0];
    if (observation !== undefined) return observation;
    await Bun.sleep(1);
  }
  throw new Error("response observation did not complete");
}

async function collectObservation(
  observation: Promise<AttributedResponseObservation>,
  observations: AttributedResponseObservation[],
): Promise<void> {
  observations.push(await observation);
}

function requestInit(): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sjerred-llm-workload": "stream-test",
    },
    body: JSON.stringify({ model: "openai/gpt-5.6-luna" }),
  };
}

test("captures router metadata from a JSON response without consuming it", async () => {
  const observations: AttributedResponseObservation[] = [];
  const responseBody = {
    id: "generation-json",
    openrouter_metadata: {
      requested: "openai/gpt-5.6-luna",
      attempts: [
        {
          provider: "Provider A",
          model: "openai/gpt-5.6-luna",
          status: 200,
        },
      ],
    },
  };
  const attributedFetch = createAttributedFetch(
    () => Promise.resolve(Response.json(responseBody)),
    (input) => {
      void collectObservation(input.observation, observations);
    },
  );

  const response = await attributedFetch(
    "https://openrouter.test/api/v1/chat/completions",
    requestInit(),
  );
  expect(await response.json()).toEqual(responseBody);
  const observation = ObservationSchema.parse(
    await waitForObservation(observations),
  );
  expect(observation.requestedModel).toBe("openai/gpt-5.6-luna");
  expect(observation.endpoint).toBe("language");
  expect(
    observation.responseBody.openrouter_metadata.attempts[0]?.provider,
  ).toBe("Provider A");
});

test("captures router metadata from the final additive SSE chunk", async () => {
  const observations: AttributedResponseObservation[] = [];
  const sse = [
    'data: {"id":"generation-sse","choices":[{"delta":{"content":"ok"}}]}',
    'data: {"id":"generation-sse","openrouter_metadata":{"requested":"openai/gpt-5.6-luna","attempts":[{"provider":"Provider B","model":"openai/gpt-5.6-luna","status":200}],"future":{"accepted":true}}}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  const attributedFetch = createAttributedFetch(
    () =>
      Promise.resolve(
        new Response(sse, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    (input) => {
      void collectObservation(input.observation, observations);
    },
  );

  const response = await attributedFetch(
    "https://openrouter.test/api/v1/chat/completions",
    requestInit(),
  );
  expect(await response.text()).toContain("[DONE]");
  const observation = ObservationSchema.parse(
    await waitForObservation(observations),
  );
  expect(
    observation.responseBody.openrouter_metadata.attempts[0]?.provider,
  ).toBe("Provider B");
});

test("keeps the final SSE metadata event without buffering the whole stream", async () => {
  const observations: AttributedResponseObservation[] = [];
  const filler = "x".repeat(4096);
  const chunks = [
    ...Array.from(
      { length: 64 },
      (_unused, index) =>
        `data: {"id":"generation-sse","choices":[{"delta":{"content":"${String(index)}${filler}"}}]}\n\n`,
    ),
    'data: {"id":"generation-sse","openrouter_metadata":{"requested":"openai/gpt-5.6-luna","attempts":[{"provider":"Provider C","model":"openai/gpt-5.6-luna","status":200}]}}\n\n',
    "data: [DONE]\n\n",
  ];
  const attributedFetch = createAttributedFetch(
    () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
              }
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      ),
    (input) => {
      void collectObservation(input.observation, observations);
    },
  );

  const response = await attributedFetch(
    "https://openrouter.test/api/v1/chat/completions",
    requestInit(),
  );
  const streamedText = await response.text();
  expect(streamedText.length).toBeGreaterThan(64 * 1024);
  const observation = ObservationSchema.parse(
    await waitForObservation(observations),
  );
  expect(
    observation.responseBody.openrouter_metadata.attempts[0]?.provider,
  ).toBe("Provider C");
});

test("abandons a JSON body larger than the inspection cap", async () => {
  const observations: AttributedResponseObservation[] = [];
  const responseBody = {
    id: "generation-oversized",
    padding: "y".repeat(128 * 1024),
    openrouter_metadata: {
      requested: "openai/gpt-5.6-luna",
      attempts: [{ provider: "Provider D", status: 200 }],
    },
  };
  const attributedFetch = createAttributedFetch(
    () => Promise.resolve(Response.json(responseBody)),
    (input) => {
      void collectObservation(input.observation, observations);
    },
  );

  const response = await attributedFetch(
    "https://openrouter.test/api/v1/chat/completions",
    requestInit(),
  );
  expect(await response.json()).toEqual(responseBody);
  const observation = await waitForObservation(observations);
  // The metadata is unreadable within the cap, but the call is still attributed.
  expect(observation.responseBody).toBeUndefined();
  expect(observation.responseStatus).toBe(200);
  expect(observation.endpoint).toBe("language");
  expect(observation.workload).toBe("stream-test");
});

test("records stable model ids, upstream attempts, and missing metadata", async () => {
  const register = new Registry();
  const metrics = runtimeMetrics(register);
  recordRouterResponse(metrics, {
    service: "test-service",
    workload: "test-workload",
    requestedModel: "openai/gpt-5.6-luna",
    responseStatus: 200,
    durationMs: 1,
    endpoint: "language",
    responseBody: {
      openrouter_metadata: {
        attempts: [
          {
            provider: "Provider A",
            model: "openai/gpt-5.6-luna",
            status: 503,
          },
          {
            provider: "Provider B",
            model: "openai/gpt-5.6-luna",
            status: 200,
          },
        ],
      },
    },
  });
  recordRouterResponse(metrics, {
    service: "test-service",
    workload: "missing-metadata",
    requestedModel: "openai/gpt-5.6-luna",
    responseStatus: 200,
    durationMs: 1,
    endpoint: "language",
    responseBody: { id: "generation-without-metadata" },
  });

  const exposition = await register.metrics();
  expect(exposition).toContain('model="gpt-5.6-luna"');
  expect(exposition).toContain(
    'upstream_provider="Provider A",outcome="error"',
  );
  expect(exposition).toContain(
    'upstream_provider="Provider B",outcome="success"',
  );
  expect(exposition).toContain('workload="missing-metadata"');
});

test("does not double-count language calls the AI SDK telemetry already recorded", async () => {
  const register = new Registry();
  const metrics = runtimeMetrics(register);
  // The fetch observer and OpenRouterMetricsTelemetry both see every language
  // call. Only the telemetry path may record the common request instruments;
  // if this observer starts recording them too, every dashboard doubles.
  recordRouterResponse(metrics, {
    service: "test-service",
    workload: "language-no-double-count",
    requestedModel: "openai/gpt-5.6-luna",
    responseStatus: 200,
    durationMs: 12,
    endpoint: "language",
    responseBody: {
      usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
      openrouter_metadata: {
        attempts: [
          { provider: "Provider A", model: "openai/gpt-5.6-luna", status: 200 },
        ],
      },
    },
  });

  const exposition = await register.metrics();
  for (const common of [
    "llm_requests_total",
    "llm_request_duration_seconds_count",
    "llm_tokens_total",
  ]) {
    expect(exposition).not.toContain(
      `${common}{service="test-service",workload="language-no-double-count"`,
    );
  }
  // The OpenRouter-specific instruments are still recorded for language.
  expect(exposition).toContain(
    'llm_router_attempts_total{service="test-service",workload="language-no-double-count"',
  );
});

test("records common request, usage, and cost metrics for image calls", async () => {
  const register = new Registry();
  const metrics = runtimeMetrics(register);
  recordRouterResponse(metrics, {
    service: "test-service",
    workload: "review.image",
    requestedModel: "google/gemini-2.5-flash-image",
    responseStatus: 200,
    durationMs: 250,
    endpoint: "image",
    responseBody: {
      id: "generation-image",
      model: "google/gemini-2.5-flash-image",
      provider: "Google",
      data: [{ b64_json: "redacted" }],
      usage: {
        prompt_tokens: 9,
        completion_tokens: 0,
        total_tokens: 9,
        cost: 0.04,
        cost_details: { upstream_inference_cost: 0.035 },
      },
      openrouter_metadata: {
        attempts: [
          {
            provider: "Google",
            model: "google/gemini-2.5-flash-image",
            status: 200,
          },
        ],
      },
    },
  });

  const exposition = await register.metrics();
  expect(exposition).toContain(
    'llm_requests_total{service="test-service",workload="review.image",provider="openrouter",model="gemini-2.5-flash-image",outcome="success"} 1',
  );
  expect(exposition).toContain(
    'llm_tokens_total{service="test-service",workload="review.image",provider="openrouter",model="gemini-2.5-flash-image",type="input"} 9',
  );
  expect(exposition).toContain(
    'model="gemini-2.5-flash-image",type="actual"} 0.04',
  );
  expect(exposition).toContain(
    'model="gemini-2.5-flash-image",type="upstream"} 0.035',
  );
  expect(exposition).toContain(
    'model="gemini-2.5-flash-image",type="catalog"} 0.039',
  );
  expect(exposition).not.toContain(
    'llm_openrouter_metadata_missing_total{service="test-service",workload="review.image"',
  );
});
