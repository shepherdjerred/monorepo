import { describe, expect, test } from "bun:test";
import type { ExploreTraceEntry } from "@scout-for-lol/data";
import {
  mintedIntentKinds,
  scenarioTurnChecks,
  type ScenarioExpectation,
  type ScenarioTurnEvidence,
} from "#src/explore/scenarios/grade.ts";

const EXPECT: ScenarioExpectation = {
  toolsCalled: [],
  toolsNotCalled: [],
  mustMentionAnyOf: [],
  mustNotMention: [],
  rubric: ["Answers the question."],
};

function entry(overrides: Partial<ExploreTraceEntry>): ExploreTraceEntry {
  return {
    toolCallId: "call-1",
    toolName: "run_report_query",
    message: "Ran a query",
    status: "succeeded",
    durationMs: 10,
    details: null,
    rawInput: null,
    rawOutput: null,
    ...overrides,
  };
}

function evidence(
  overrides: Partial<ScenarioTurnEvidence> = {},
): ScenarioTurnEvidence {
  return {
    surface: "web",
    answer: { answer: "Here you go.", followUps: [] },
    trace: [],
    imageDelivered: null,
    ...overrides,
  };
}

function check(checks: ReturnType<typeof scenarioTurnChecks>, name: string) {
  const found = checks.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`No check named ${name}`);
  return found;
}

const PREPARED = entry({
  toolName: "prepare_subscription_creation",
  rawOutput: {
    kind: "value",
    byteLength: 10,
    value: {
      kind: "creation_confirmation_required",
      message: "Nothing has been created yet.",
      intent: { kind: "subscription" },
    },
  },
});

describe("mintedIntentKinds", () => {
  test("reads the kind of every prepared confirmation card", () => {
    expect(mintedIntentKinds([PREPARED])).toEqual(["subscription"]);
  });

  test("ignores refusals and failed calls", () => {
    const refused = entry({
      toolName: "prepare_report_creation",
      rawOutput: {
        kind: "value",
        byteLength: 10,
        value: { kind: "limit_reached", message: "At limit.", intent: null },
      },
    });
    expect(
      mintedIntentKinds([refused, { ...PREPARED, status: "failed" }]),
    ).toEqual([]);
  });
});

describe("scenarioTurnChecks", () => {
  test("a turn with no answer fails 'answered' and every mention", () => {
    const checks = scenarioTurnChecks({
      expect: { ...EXPECT, mustMentionAnyOf: [["Omz"]] },
      evidence: evidence({ answer: null }),
      hasImage: false,
    });
    expect(check(checks, "answered").passed).toBe(false);
    expect(check(checks, "mentions:Omz").passed).toBe(false);
  });

  test("tool groups pass when any member ran successfully", () => {
    const checks = scenarioTurnChecks({
      expect: { ...EXPECT, toolsCalled: [["lookup_rune", "lookup_champion"]] },
      evidence: evidence({
        trace: [
          entry({ toolName: "lookup_rune", status: "failed" }),
          entry({ toolName: "lookup_champion" }),
        ],
      }),
      hasImage: false,
    });
    expect(check(checks, "tool:lookup_rune|lookup_champion").passed).toBe(true);
  });

  test("a failed tool call does not count as having run", () => {
    const checks = scenarioTurnChecks({
      expect: { ...EXPECT, toolsCalled: [["lookup_rune"]] },
      evidence: evidence({
        trace: [entry({ toolName: "lookup_rune", status: "failed" })],
      }),
      hasImage: false,
    });
    expect(check(checks, "tool:lookup_rune").passed).toBe(false);
  });

  test("intent checks require a card of the expected kind", () => {
    const passing = scenarioTurnChecks({
      expect: { ...EXPECT, intentMinted: "subscription" },
      evidence: evidence({ trace: [PREPARED] }),
      hasImage: false,
    });
    const failing = scenarioTurnChecks({
      expect: { ...EXPECT, intentMinted: "report" },
      evidence: evidence({ trace: [PREPARED] }),
      hasImage: false,
    });
    expect(check(passing, "intent:subscription").passed).toBe(true);
    expect(check(failing, "intent:report").passed).toBe(false);
  });

  test("phrase checks expand contractions and curly apostrophes", () => {
    const checks = scenarioTurnChecks({
      expect: {
        ...EXPECT,
        mustNotMention: ["nothing has been created"],
        mustMentionAnyOf: [["cannot be customized"]],
      },
      evidence: evidence({
        answer: {
          answer:
            "Nothing’s changed: it can’t be customized. Nothing has been created.",
          followUps: [],
        },
      }),
      hasImage: false,
    });
    expect(check(checks, "mentions:cannot be customized").passed).toBe(true);
    expect(check(checks, "avoids:nothing has been created").passed).toBe(false);
  });

  test("voice answers are checked on what is spoken too", () => {
    const checks = scenarioTurnChecks({
      expect: { ...EXPECT, mustMentionAnyOf: [["player feed"]] },
      evidence: evidence({
        surface: "voice",
        answer: {
          answer: "Feeds post after each game.",
          spokenAnswer: "A player feed posts after every game.",
          followUps: [],
        },
      }),
      hasImage: false,
    });
    expect(check(checks, "mentions:player feed").passed).toBe(true);
  });

  test.each([
    "Please send your numeric Discord user ID so I can prepare the confirmation.",
    "I need your Discord user ID to prepare the player feed.",
    "Send me their snowflake ID.",
  ])("flags a request for a raw id: %s", (answer) => {
    const checks = scenarioTurnChecks({
      expect: EXPECT,
      evidence: evidence({ answer: { answer, followUps: [] } }),
      hasImage: false,
    });
    expect(check(checks, "no-numeric-id-request").passed).toBe(false);
  });

  test("mentioning a linked Discord account is not a request for an id", () => {
    const checks = scenarioTurnChecks({
      expect: EXPECT,
      evidence: evidence({
        answer: {
          answer:
            "The feed will be linked to shadowpumpkin23's Discord account.",
          followUps: [],
        },
      }),
      hasImage: false,
    });
    expect(check(checks, "no-numeric-id-request").passed).toBe(true);
  });

  test("an action chip fails; a question chip passes", () => {
    const action = scenarioTurnChecks({
      expect: EXPECT,
      evidence: evidence({
        answer: {
          answer: "Prepared.",
          followUps: ["Confirm the weekly report in Explore"],
        },
      }),
      hasImage: false,
    });
    const question = scenarioTurnChecks({
      expect: EXPECT,
      evidence: evidence({
        answer: {
          answer: "Prepared.",
          followUps: ["Show each player's last five games"],
        },
      }),
      hasImage: false,
    });
    expect(check(action, "follow-ups-are-questions").passed).toBe(false);
    expect(check(question, "follow-ups-are-questions").passed).toBe(true);
  });

  test("an image turn fails until the image reaches the agent", () => {
    const undelivered = scenarioTurnChecks({
      expect: EXPECT,
      evidence: evidence({ imageDelivered: false }),
      hasImage: true,
    });
    const delivered = scenarioTurnChecks({
      expect: EXPECT,
      evidence: evidence({ imageDelivered: true }),
      hasImage: true,
    });
    expect(check(undelivered, "image-delivered").passed).toBe(false);
    expect(check(delivered, "image-delivered").passed).toBe(true);
  });
});
