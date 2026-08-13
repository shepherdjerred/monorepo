import { describe, expect, test } from "bun:test";
import { getHomeAssistantRuleGroups } from "./homeassistant.ts";

describe("Home Assistant rules", () => {
  test("alerts when the master bathroom temperature is unavailable or absent", () => {
    const availabilityGroup = getHomeAssistantRuleGroups().find(
      (group) => group.name === "homeassistant-availability",
    );
    if (availabilityGroup?.rules === undefined) {
      throw new Error("Missing homeassistant-availability rules");
    }

    const rule = availabilityGroup.rules.find(
      (candidate) =>
        candidate.alert === "HomeAssistantMasterBathroomTemperatureUnavailable",
    );
    if (rule === undefined) {
      throw new Error(
        "Missing HomeAssistantMasterBathroomTemperatureUnavailable rule",
      );
    }

    expect(rule.for).toBe("15m");
    // The absent() arm is load-bearing: a comparison alone yields an empty
    // vector when the entity never makes it into the exported state set.
    expect(rule.expr.value).toBe(
      'homeassistant_entity_available{entity="sensor.master_bathroom_temperature"} == 0 or absent(homeassistant_entity_available{entity="sensor.master_bathroom_temperature"})',
    );
    expect(rule.annotations?.["runbook_url"]).toBe(
      "https://homeassistant.tailnet-1a49.ts.net/history?entity_id=sensor.master_bathroom_temperature",
    );
  });

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

  test("uses gauge-safe battery trend math for the Roborock alert", () => {
    const roborockGroup = getHomeAssistantRuleGroups().find(
      (group) => group.name === "homeassistant-roborock",
    );
    if (roborockGroup?.rules === undefined) {
      throw new Error("Missing homeassistant-roborock rule group");
    }

    const rule = roborockGroup.rules.find(
      (candidate) => candidate.alert === "RoborockBatteryLowNotCharging",
    );
    if (rule === undefined) {
      throw new Error("Missing RoborockBatteryLowNotCharging rule");
    }

    const expression = rule.expr.value;
    if (typeof expression !== "string") {
      throw new TypeError(
        "Expected Roborock battery expression to be a string",
      );
    }
    expect(expression).toContain("delta(");
    expect(expression).not.toContain("increase(");
  });

  test("treats every missing Roborock template dependency as a problem", async () => {
    const configuration = await Bun.file(
      new URL(
        "../../../../../config/homeassistant/configuration.yaml",
        import.meta.url,
      ),
    ).text();

    for (const floor of ["1st", "2nd", "3rd"]) {
      expect(configuration).toContain(
        `states('vacuum.${floor}_floor') in ['error', 'unknown', 'unavailable']`,
      );
      expect(configuration).toContain(
        `states('sensor.${floor}_floor_status') in ['error', 'charging_problem', 'unknown', 'unavailable']`,
      );
      expect(configuration).toContain(
        `states('sensor.${floor}_floor_vacuum_error') not in ['none', 'low_battery', 'robot_on_carpet']`,
      );
      expect(configuration).toContain(
        `states('sensor.${floor}_floor_dock_dock_error') != 'ok'`,
      );
    }
  });
});
