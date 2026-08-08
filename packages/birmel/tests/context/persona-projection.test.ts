import { describe, expect, test } from "bun:test";
import { getStyleCard } from "@shepherdjerred/glitter-context";
import { CONTEXT_BUDGETS } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  buildCompactPersonaProjection,
  buildConfiguredPersonaProjection,
} from "@shepherdjerred/birmel/persona/projection.ts";

describe("buildCompactPersonaProjection", () => {
  test("builds a deterministic projection within the persona budget", () => {
    const first = buildCompactPersonaProjection("jerred");
    const second = buildCompactPersonaProjection("jerred");

    expect(second).toBe(first);
    expect(first.length).toBeLessThanOrEqual(CONTEXT_BUDGETS.persona);
    expect(first).toContain("## Elected persona: jerred");
    expect(first).toContain(
      "Authority, safety, typed contracts, and tool limits outrank persona style.",
    );
  });

  test("projects a compact subset instead of the full style corpus", () => {
    const style = getStyleCard("jerred");
    if (style == null) {
      throw new Error("Expected the deterministic Jerred style-card fixture");
    }

    const projection = buildCompactPersonaProjection("jerred");
    const representativeBlock = projection
      .split("\n\n")
      .find((block) => block.startsWith("Representative messages:\n"));
    const projectedSamples = representativeBlock?.split("\n").slice(1) ?? [];

    expect(projectedSamples).toEqual(
      style.sample_messages.slice(0, 6).map((sample) => `- ${sample}`),
    );

    expect(projection.length).toBeLessThan(JSON.stringify(style).length);
    expect(projectedSamples.length).toBeLessThan(style.sample_messages.length);
    expect(projectedSamples).toHaveLength(6);
    expect(projection).not.toContain(JSON.stringify(style));
  });

  test("uses a concise fallback for a persona without a style card", () => {
    const projection = buildCompactPersonaProjection("unknown-persona");

    expect(projection).toBe(
      "## Elected persona\nYou are unknown-persona. Keep the response concise and conversational.",
    );
    expect(projection.length).toBeLessThanOrEqual(CONTEXT_BUDGETS.persona);
  });

  test("caps an oversized fallback persona at the persona budget", () => {
    const projection = buildCompactPersonaProjection(
      `unknown-${"p".repeat(CONTEXT_BUDGETS.persona)}`,
    );

    expect(projection.length).toBeLessThanOrEqual(CONTEXT_BUDGETS.persona);
  });

  test("omits the projection when persona behavior is disabled", () => {
    expect(buildConfiguredPersonaProjection("jerred", false)).toBe("");
    expect(buildConfiguredPersonaProjection("jerred", true)).toContain(
      "## Elected persona: jerred",
    );
  });
});
