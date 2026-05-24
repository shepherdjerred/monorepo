import { describe, expect, test } from "bun:test";
import { getHomeAssistantRuleGroups } from "./homeassistant.ts";

describe("Home Assistant rules", () => {
  test("renders a Prometheus-template-safe unavailable entity annotation query", () => {
    const availabilityGroup = getHomeAssistantRuleGroups().find(
      (group) => group.name === "homeassistant-availability",
    );
    if (availabilityGroup === undefined) {
      throw new Error("Missing homeassistant-availability rule group");
    }

    const rules = availabilityGroup.rules;
    if (rules === undefined) {
      throw new Error("Missing homeassistant-availability rules");
    }

    const rule = rules.find(
      (candidate) => candidate.alert === "HomeAssistantEntitiesUnavailable",
    );
    if (rule === undefined) {
      throw new Error("Missing HomeAssistantEntitiesUnavailable rule");
    }

    const description = rule.annotations?.["description"];
    if (description === undefined) {
      throw new Error("Missing HomeAssistantEntitiesUnavailable description");
    }

    expect(description).toContain("[.].*");
    expect(description).not.toContain(String.raw`\\..*`);
  });
});
