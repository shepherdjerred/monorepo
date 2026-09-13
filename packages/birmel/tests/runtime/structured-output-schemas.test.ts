import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createOpenRouterRuntime,
  generateValidatedObject,
} from "@shepherdjerred/llm-runtime";
import { TurnAnswerSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
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

/**
 * A runtime whose transport replays canned responses and records each raw
 * request body, so a test can assert on either the serialized schema or the
 * prompt that was sent.
 */
function recordingRuntime(
  responses: string[],
  recordRequestBody: (body: string) => void,
) {
  return createOpenRouterRuntime({
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
        recordRequestBody(init.body);
        const response = responses.shift();
        if (response === undefined) {
          throw new Error("unexpected structured-output request");
        }
        return openRouterResponse(response);
      },
      { preconnect: (url: string | URL) => void url },
    ),
  });
}

describe("Birmel provider structured-output schemas", () => {
  test("serializes every production object with all properties required", async () => {
    const bodies: unknown[] = [];
    const responses = [
      JSON.stringify({ shouldRespond: false, reason: null }),
      JSON.stringify({
        answer: "No registered tool can do that.",
        disposition: "unsupported",
      }),
      JSON.stringify({ humanClaims: [], selfMemories: [] }),
    ];
    const runtime = recordingRuntime(responses, (body) => {
      bodies.push(JSON.parse(body));
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
      schema: TurnAnswerSchema,
      schemaName: "birmel_turn_answer",
      prompt: "Answer.",
      workload: "schema-test.answer",
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

  // Production kept emitting relationship claims naming a single user, which
  // passed extraction and then threw during persistence, losing every claim in
  // the turn. The rule now lives in the schema, so the extractor is told what
  // it got wrong and corrects itself instead.
  test("re-prompts the extractor when a relationship claim names one user", async () => {
    const prompts: string[] = [];
    const claim = {
      subject: "Jerred and Alice",
      predicate: "relationship",
      value: "close friends",
      confidence: 0.8,
      salience: 0.7,
      origin: "inferred",
      validFrom: null,
      validUntil: null,
      sourceDiscordMessageIds: ["600"],
    };
    const responses = [
      JSON.stringify({
        humanClaims: [
          { ...claim, scope: "relationship", relatedUserIds: ["400"] },
        ],
        selfMemories: [],
      }),
      JSON.stringify({
        humanClaims: [
          { ...claim, scope: "relationship", relatedUserIds: ["400", "500"] },
        ],
        selfMemories: [],
      }),
    ];
    const runtime = recordingRuntime(responses, (body) => {
      prompts.push(body);
    });

    const result = await generateValidatedObject(runtime, {
      model: "gpt-5.6-luna",
      schema: ExtractionSchema,
      schemaName: "birmel_memory_candidates",
      prompt: "Extract.",
      workload: "schema-test.memory",
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("relatedUserIds");
    expect(prompts[1]).toContain("at least two distinct related user IDs");
    expect(result.object.humanClaims[0]?.relatedUserIds).toEqual([
      "400",
      "500",
    ]);
  });
});
