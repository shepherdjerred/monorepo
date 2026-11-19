import { describe, expect, test } from "vitest";
import {
  CoachGameContextSchema,
  ExploreGenerationSchema,
} from "@scout-for-lol/data";
import coachFixtures from "@scout-for-lol/data/scout-client/coach-context.fixtures.json" with { type: "json" };
import { z } from "zod";
import {
  budgetErrorOf,
  exploreFailureCode,
  turnProvenance,
} from "#src/explore/runs/run-turn.ts";
import { ExploreBudgetError } from "#src/explore/spending/ledger.ts";
import { toMessage } from "#src/explore/store-mappers.ts";

const STARTED = {
  model: "gpt-6.1-sol",
  conversationId: "7c3e5a91-2b64-4d0f-8e17-5a9c4b2d6f30",
  title: "Build",
  messageId: "e5b7c9d1-3f24-4a6b-8c8e-0d2f4a6b8c01",
  question: "What should I build next?",
  expectedCurrentLeafId: null,
};
const LIVE = z
  .record(z.string(), z.unknown())
  .parse(coachFixtures.valid[0]?.body)["live"];

describe("answer provenance", () => {
  test("an in-game answer records low effort and the model that wrote it", () => {
    const coach = CoachGameContextSchema.parse({ live: LIVE });
    const generation = turnProvenance(STARTED, coach);
    expect(generation).toEqual({
      model: "gpt-6-luna",
      reasoningEffort: "low",
    });
    // What is stored is what a reader parses back.
    expect(ExploreGenerationSchema.parse(generation)).toEqual(generation);
  });

  test("an ordinary answer records high effort and the turn's own model", () => {
    expect(turnProvenance(STARTED, null)).toEqual({
      model: "gpt-6.1-sol",
      reasoningEffort: "high",
    });
    expect(
      turnProvenance({ ...STARTED, model: undefined }, undefined),
    ).toBeUndefined();
  });

  test("a stored low-effort answer reads back with its effort", () => {
    const message = toMessage(
      {
        id: "a1c3e5f7-0b2d-4f68-8a0c-2e4f6a8c0e13",
        parentId: STARTED.messageId,
        role: "assistant",
        content: "Build Zhonya's.",
        generation: JSON.stringify({
          model: "gpt-6-luna",
          reasoningEffort: "low",
        }),
        spokenContent: "Build Zhonya's.",
        queryText: null,
        caveats: "[]",
        followUps: "[]",
        coachOptions: null,
        preview: null,
        visualization: null,
        matchCards: null,
        loadoutCards: null,
        guildIds: null,
        trace: null,
        createdAt: new Date("2026-11-14T09:12:30.000Z"),
      },
      { siblingIds: [], index: 0, count: 1 },
    );
    expect(message.generation).toEqual({
      model: "gpt-6-luna",
      reasoningEffort: "low",
    });
  });
});

describe("budget error surfacing", () => {
  test("finds a budget error wrapped by the SDK", () => {
    const budget = new ExploreBudgetError("input_limit");
    const wrapped = new Error("stream failed", { cause: budget });
    expect(budgetErrorOf(wrapped)).toBe(budget);
    expect(exploreFailureCode("failed", wrapped)).toBe(
      "explore:budget_exceeded",
    );
  });

  test("ignores unrelated errors", () => {
    expect(budgetErrorOf(new Error("boom"))).toBeNull();
    expect(exploreFailureCode("failed", new Error("boom"))).toBe(
      "explore:execution_failed",
    );
  });
});
