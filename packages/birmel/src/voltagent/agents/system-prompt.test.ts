import { describe, expect, test } from "bun:test";
import {
  type PersonaContext,
  buildPersonaBlock,
  buildSubAgentPrompt,
  buildSupervisorPrompt,
} from "@shepherdjerred/birmel/voltagent/agents/system-prompt.ts";
import {
  friendGroupHistory,
  relationshipContextText,
} from "@shepherdjerred/glitter-context";
import { StylePromptContextSchema } from "@shepherdjerred/glitter-context/schema";

const GLITTER_BOYS_RELATIONSHIPS = relationshipContextText();

const persona: PersonaContext = {
  format: "compact",
  name: "TestPersona",
  voice: "- terse\n- dry",
  markers: "- lowercase\n- few periods",
  samples: ["yep", "nah", "go off"],
};

const thickPersona: PersonaContext = {
  format: "thick",
  name: "ThickPersona",
  style: StylePromptContextSchema.parse({
    author: "Thick Persona",
    voice: ["Complete voice observation"],
    style_markers: ["Complete style marker"],
    topics: ["Complete topic"],
    relationships: ["Complete relationship behavior"],
    behaviors: ["Complete behavior"],
    personality: ["Complete personality observation"],
    humor_or_tone: ["Complete humor observation"],
    summary: "Complete summary",
    likes_dislikes: ["Complete preference"],
    league: { role: "Complete League observation" },
    other_games: ["Complete other game observation"],
    how_to_mimic: ["Complete mimic guidance"],
    quotes: Array.from({ length: 20 }, (_, index) => `quote-${String(index)}`),
    sample_messages: Array.from(
      { length: 30 },
      (_, index) => `sample-${String(index)}`,
    ),
    situational_examples: {
      provenance: "synthetic",
      happy_or_excited: ["happy-0", "happy-1", "happy-2"],
      angry_or_frustrated: ["angry-0", "angry-1", "angry-2"],
      sad_or_disappointed: ["sad-0", "sad-1", "sad-2"],
      supportive_or_caring: ["supportive-0", "supportive-1", "supportive-2"],
      playful_or_teasing: ["playful-0", "playful-1", "playful-2"],
      neutral_or_logistical: ["neutral-0", "neutral-1", "neutral-2"],
    },
    concerns: ["Complete concern"],
  }),
};

function firstHistoryLine(): string {
  const line = friendGroupHistory.trim().split("\n")[0];
  if (line === undefined || line.length === 0) {
    throw new Error("shared Glitter history unexpectedly empty");
  }
  return line;
}

function firstRelationshipLine(): string {
  const line = GLITTER_BOYS_RELATIONSHIPS.trim().split("\n")[0];
  if (line === undefined || line.length === 0) {
    throw new Error("shared relationship projection unexpectedly empty");
  }
  return line;
}

describe("buildPersonaBlock", () => {
  test("returns empty string when persona is null (no silent persona-skip leakage into prompt)", () => {
    expect(buildPersonaBlock(null)).toBe("");
  });

  test("includes persona name, voice, markers, and samples when persona is supplied", () => {
    const block = buildPersonaBlock(persona);
    expect(block).toContain("## Persona: TestPersona");
    expect(block).toContain("**Voice Characteristics:**");
    expect(block).toContain("- terse");
    expect(block).toContain("**Style Markers:**");
    expect(block).toContain("- lowercase");
    expect(block).toContain("**Example Messages");
    expect(block).toContain('"yep"');
    expect(block).toContain('"nah"');
    expect(block).toContain('"go off"');
    expect(block).toContain("**Name mapping.**");
  });

  test("limits samples to 10", () => {
    const many = {
      ...persona,
      samples: Array.from({ length: 25 }, (_, i) => `s${i.toString()}`),
    };
    const block = buildPersonaBlock(many);
    expect(block).toContain('"s0"');
    expect(block).toContain('"s9"');
    expect(block).not.toContain('"s10"');
  });

  test("includes the complete V2 context without operational metadata", () => {
    const block = buildPersonaBlock(thickPersona);
    expect(block).toContain("Complete voice observation");
    expect(block).toContain('"quote-19"');
    expect(block).toContain('"sample-29"');
    expect(block).toContain('"neutral-2"');
    expect(block).not.toContain("schemaVersion");
    expect(block).not.toContain('"coverage"');
  });
});

describe("buildSupervisorPrompt", () => {
  test("contains supervisor base + persona block + full glitter lore when persona is set", () => {
    const prompt = buildSupervisorPrompt(persona);
    expect(prompt).toContain("You are Birmel");
    expect(prompt).toContain("delegate_task");
    expect(prompt).toContain("durable cron/jobs/reminders");
    expect(prompt).toContain("Use web-research before claiming current facts");
    expect(prompt).toContain("Use agent sessions for long-running work");
    expect(prompt).toContain("## Persona: TestPersona");
    expect(prompt).toContain("- terse");
    expect(prompt).toContain("## Friend group context (Glitter Boys)");
    expect(prompt).toContain(firstHistoryLine());
    expect(prompt).toContain("### How everyone knows each other");
    expect(prompt).toContain(firstRelationshipLine());
  });

  test("still emits glitter lore when persona is null, but omits the persona heading", () => {
    const prompt = buildSupervisorPrompt(null);
    expect(prompt).toContain("You are Birmel");
    expect(prompt).not.toContain("## Persona:");
    expect(prompt).toContain("## Friend group context (Glitter Boys)");
    expect(prompt).toContain(firstHistoryLine());
    expect(prompt).toContain(firstRelationshipLine());
  });
});

describe("buildSubAgentPrompt", () => {
  test("contains base + agent-specific fields + persona block + full glitter lore", () => {
    const prompt = buildSubAgentPrompt({
      agentName: "test-agent",
      responsibilities: "FINGERPRINT-RESPONSIBILITIES handle test things",
      toolGuidance: "FINGERPRINT-TOOLS use the test_tool",
      persona,
    });
    expect(prompt).toContain("specialist sub-agent for the Birmel Discord bot");
    expect(prompt).toContain("Use durable jobs for `at`, `every`, cron");
    expect(prompt).toContain("Use agent sessions when work is resumable");
    expect(prompt).toContain("## Your role: test-agent");
    expect(prompt).toContain("FINGERPRINT-RESPONSIBILITIES handle test things");
    expect(prompt).toContain("FINGERPRINT-TOOLS use the test_tool");
    expect(prompt).toContain("## Persona: TestPersona");
    expect(prompt).toContain("## Friend group context (Glitter Boys)");
    expect(prompt).toContain(firstHistoryLine());
    expect(prompt).toContain(firstRelationshipLine());
  });

  test("includes glitter lore even when persona is null", () => {
    const prompt = buildSubAgentPrompt({
      agentName: "test-agent",
      responsibilities: "x",
      toolGuidance: "y",
      persona: null,
    });
    expect(prompt).not.toContain("## Persona:");
    expect(prompt).toContain("## Friend group context (Glitter Boys)");
    expect(prompt).toContain(firstHistoryLine());
    expect(prompt).toContain(firstRelationshipLine());
  });
});

describe("bundled glitter lore content sanity", () => {
  test("history file starts with the expected title (catches accidental clear/replace)", () => {
    expect(friendGroupHistory.trim().length).toBeGreaterThan(100);
    expect(friendGroupHistory).toContain("Glitter Boys");
  });

  test("relationship projection includes the current Caitlyn and Richard state", () => {
    expect(GLITTER_BOYS_RELATIONSHIPS.trim().length).toBeGreaterThan(100);
    expect(GLITTER_BOYS_RELATIONSHIPS).toContain("Caitlyn ↔ Richard (Exes)");
  });
});
