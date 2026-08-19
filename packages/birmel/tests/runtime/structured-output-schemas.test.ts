import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  createOpenRouterRuntime,
  generateValidatedObject,
} from "@shepherdjerred/llm-runtime";
import { RouteDecisionSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { ExtractionSchema } from "@shepherdjerred/birmel/agent-runtime/memory-extraction.ts";
import { ClassificationSchema } from "@shepherdjerred/birmel/discord/should-respond-classifier.ts";

const JsonRecordSchema = z.record(z.string(), z.unknown());
const PropertiesSchema = z.record(z.string(), z.unknown());
const RequiredSchema = z.array(z.string());
const RequestBodySchema = z
  .object({
    response_format: z.object({
      type: z.literal("json_schema"),
      json_schema: z.object({ schema: z.unknown() }).loose(),
    }),
  })
  .loose();

function expectCompleteRequiredArrays(node: unknown, path = "$schema"): void {
  if (Array.isArray(node)) {
    for (const [index, value] of node.entries()) {
      expectCompleteRequiredArrays(value, `${path}[${String(index)}]`);
    }
    return;
  }
  const parsed = JsonRecordSchema.safeParse(node);
  if (!parsed.success) {
    return;
  }
  const record = parsed.data;
  if (record["type"] === "object") {
    const properties = PropertiesSchema.parse(record["properties"]);
    const required = RequiredSchema.parse(record["required"]);
    expect(required.toSorted()).toEqual(Object.keys(properties).toSorted());
  }
  for (const [key, value] of Object.entries(record)) {
    expectCompleteRequiredArrays(value, `${path}.${key}`);
  }
}

function openRouterResponse(content: string): Response {
  return Response.json({
    id: "gen-schema-test",
    model: "openai/gpt-5.6-luna",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
    },
  });
}

describe("Birmel provider structured-output schemas", () => {
  test("serializes every production object with all properties required", async () => {
    const bodies: unknown[] = [];
    const responses = [
      JSON.stringify({ shouldRespond: false, reason: null }),
      JSON.stringify({
        route: "direct",
        disposition: "unsupported",
        primaryToolId: null,
        confidence: 1,
        rationale: "No registered capability",
      }),
      JSON.stringify({ humanClaims: [], selfMemories: [] }),
    ];
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "birmel-schema-test",
      appName: "birmel-schema-test",
      fetch: Object.assign(
        async (
          _input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          if (typeof init?.body !== "string") {
            throw new TypeError("expected JSON request body");
          }
          bodies.push(JSON.parse(init.body));
          const response = responses.shift();
          if (response === undefined) {
            throw new Error("unexpected structured-output request");
          }
          return openRouterResponse(response);
        },
        { preconnect: (url: string | URL) => void url },
      ),
    });

    await generateValidatedObject(runtime, {
      model: "gpt-5.6-luna",
      schema: ClassificationSchema,
      schemaName: "birmel_should_respond",
      prompt: "Classify.",
      workload: "schema-test.admission",
    });
    await generateValidatedObject(runtime, {
      model: "gpt-5.6-luna",
      schema: RouteDecisionSchema,
      schemaName: "birmel_route_decision",
      prompt: "Route.",
      workload: "schema-test.route",
    });
    await generateValidatedObject(runtime, {
      model: "gpt-5.6-luna",
      schema: ExtractionSchema,
      schemaName: "birmel_memory_candidates",
      prompt: "Extract.",
      workload: "schema-test.memory",
    });

    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      const schema =
        RequestBodySchema.parse(body).response_format.json_schema.schema;
      expectCompleteRequiredArrays(schema);
    }
  });
});
