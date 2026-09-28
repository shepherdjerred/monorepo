import { describe, expect, test } from "vitest";
import {
  ClassifyRequestSchema,
  ClassifyResponseSchema,
  ClassifyVerdictSchema,
  TriageDraftSchema,
  TriageRequestSchema,
  TriageResponseSchema,
} from "#src/schemas.ts";
import { triageRequestBody } from "./fixtures.ts";

describe("storm-brain schemas", () => {
  test("rejects unknown keys on requests and responses", () => {
    expect(() =>
      ClassifyRequestSchema.parse({
        player: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", name: "Alice" },
        lines: [{ text: "hi", at: "2017-06-01T12:00:00.000Z" }],
        bogus: true,
      }),
    ).toThrow();

    expect(() =>
      ClassifyResponseSchema.parse({
        offense: null,
        confidence: 0,
        label: "clean-chat",
        reasoning: "ordinary chat",
        model: "gpt-5.6-luna",
        costMicros: 3,
        bogus: true,
      }),
    ).toThrow();

    expect(() =>
      TriageResponseSchema.parse({
        priorityId: "normal",
        confidence: 0.8,
        duplicates: [],
        evidence: "x",
        draftReply: "y",
        resolve: false,
        resolutionNote: "",
        model: "gpt-5.6-luna",
        costMicros: 3,
        bogus: true,
      }),
    ).toThrow();
  });

  test("the brain can only name enforceable offenses", () => {
    expect(() =>
      ClassifyVerdictSchema.parse({
        offense: "other",
        confidence: 0.9,
        label: "x",
        reasoning: "y",
      }),
    ).toThrow();
    const clean = ClassifyVerdictSchema.parse({
      offense: null,
      confidence: 0.1,
      label: "clean-chat",
      reasoning: "ordinary chat",
    });
    expect(clean.offense).toBeNull();
  });

  test("triage uses the ticket priority vocabulary", () => {
    expect(() =>
      TriageDraftSchema.parse({
        priorityId: "high",
        confidence: 0.9,
        duplicates: [],
        evidence: "x",
        draftReply: "y",
        resolve: false,
        resolutionNote: "",
      }),
    ).toThrow();
    expect(TriageRequestSchema.parse(triageRequestBody()).ticket.id).toBe(1);
  });
});
