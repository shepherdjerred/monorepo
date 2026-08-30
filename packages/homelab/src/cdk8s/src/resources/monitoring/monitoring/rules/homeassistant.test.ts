import { Glob } from "bun";
import { describe, expect, test } from "vitest";
import {
  getHomeAssistantRuleGroups,
  TEMPORAL_AUTOMATION_ENTITY_IDS,
} from "./homeassistant.ts";

const HA_WORKFLOW_DIR = new URL(
  "../../../../../../../../temporal/src/workflows/ha/",
  import.meta.url,
).pathname;

// A string literal that is *entirely* `<domain>.<object_id>`. Anchoring on the
// whole literal is what separates an entity from a module specifier
// ("./util.ts", "#shared/x.ts"), which always carry a slash. Deliberately not a
// fixed domain allowlist: a workflow adopting a new HA domain must still be
// caught, and an allowlist would silently exempt exactly that case.
const ENTITY_PATTERN = /["'`]([a-z_]+\.[a-z0-9_]+)["'`]/g;

async function collectWorkflowEntityIds(): Promise<Set<string>> {
  const entities = new Set<string>();
  for await (const file of new Glob("*.ts").scan(HA_WORKFLOW_DIR)) {
    if (file.endsWith(".test.ts")) continue;
    const source = await Bun.file(`${HA_WORKFLOW_DIR}${file}`).text();
    for (const match of source.matchAll(ENTITY_PATTERN)) {
      const entity = match[1];
      if (entity !== undefined) entities.add(entity);
    }
  }
  return entities;
}

describe("Home Assistant rules", () => {
  test("uses the requested pet-care threshold boundaries without overlap", () => {
    const groups = getHomeAssistantRuleGroups();
    const litterRules = groups.find(
      (group) => group.name === "homeassistant-litter-robot",
    )?.rules;
    const fountainRules = groups.find(
      (group) => group.name === "homeassistant-petlibro-fountain",
    )?.rules;
    if (litterRules === undefined || fountainRules === undefined) {
      throw new Error("Missing pet-care rule groups");
    }

    expect(
      fountainRules.find((rule) => rule.alert === "PetLibroFountainWaterLow")
        ?.expr.value,
    ).toContain(" < 60");
    expect(
      litterRules.find((rule) => rule.alert === "LitterRobotLitterLow")?.expr
        .value,
    ).toBe("trmnl_petcare_litter_percent < 60");
    expect(
      litterRules.find((rule) => rule.alert === "LitterRobotWasteHigh")?.expr
        .value,
    ).toBe(
      "trmnl_petcare_litter_waste_percent > 60 and trmnl_petcare_litter_waste_percent <= 80",
    );
    expect(
      litterRules.find((rule) => rule.alert === "LitterRobotWasteCritical")
        ?.expr.value,
    ).toBe("trmnl_petcare_litter_waste_percent > 80");
  });

  test("monitors both PetLibro feeders and all three Roborocks for missing entities", () => {
    const groups = getHomeAssistantRuleGroups();
    const feederRules = groups.find(
      (group) => group.name === "homeassistant-petlibro-feeders",
    )?.rules;
    const availabilityRules = groups.find(
      (group) => group.name === "homeassistant-availability",
    )?.rules;
    if (feederRules === undefined || availabilityRules === undefined) {
      throw new Error("Missing feeder or availability rules");
    }

    expect(
      feederRules.some((rule) =>
        rule.alert?.startsWith("PetLibroFeederLivingRoom"),
      ),
    ).toBe(true);
    expect(
      feederRules.some((rule) =>
        rule.alert?.startsWith("PetLibroFeederGuestRoom"),
      ),
    ).toBe(true);
    const petAvailability = availabilityRules.filter(
      (rule) => rule.alert === "PetCareEntityUnavailable",
    );
    for (const floor of ["1st", "2nd", "3rd"]) {
      expect(
        petAvailability.some(
          (rule) => rule.labels?.["entity"] === `vacuum.${floor}_floor`,
        ),
      ).toBe(true);
    }
  });

  test("uses diagnostics metrics for LR5 and never retains LR4 or PetKit rules", () => {
    const serialized = JSON.stringify(getHomeAssistantRuleGroups());

    expect(serialized).toContain("trmnl_petcare_litter_hopper_status");
    expect(serialized).toContain("trmnl_petcare_litter_ha_mismatch");
    expect(serialized).not.toContain("litter_robot_4");
    expect(serialized).not.toContain("Eversweet");
  });

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

  test("records complete inventory and alerts only on explicit automation dependencies", () => {
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

    const inventory = rules.find(
      (candidate) =>
        candidate.record === "homeassistant:unavailable_entities_total",
    );
    if (inventory === undefined) {
      throw new Error("Missing unavailable entity inventory recording rule");
    }
    expect(inventory.expr.value).toBe(
      "count(homeassistant_entity_available == 0) or vector(0)",
    );
    expect(
      rules.some(
        (candidate) => candidate.alert === "HomeAssistantEntitiesUnavailable",
      ),
    ).toBe(false);
    const dependencies = rules.filter(
      (candidate) =>
        candidate.alert === "HomeAssistantAutomationDependencyUnavailable",
    );
    expect(dependencies).toHaveLength(TEMPORAL_AUTOMATION_ENTITY_IDS.length);
    expect(dependencies.map((rule) => rule.labels?.["entity"])).toEqual([
      ...TEMPORAL_AUTOMATION_ENTITY_IDS,
    ]);
    for (const rule of dependencies) {
      expect(rule.expr.value).toContain("or absent(");
    }
  });

  test("does not keep the retired self-referential availability sensor", async () => {
    const configuration = await Bun.file(
      new URL(
        "../../../../../config/homeassistant/configuration.yaml",
        import.meta.url,
      ),
    ).text();

    expect(configuration).not.toContain("unavailable_entities_count");
  });

  test("alerts on every entity the Temporal HA workflows depend on", async () => {
    const workflowEntities = await collectWorkflowEntityIds();
    expect(workflowEntities.size).toBeGreaterThan(0);

    const covered = new Set<string>(TEMPORAL_AUTOMATION_ENTITY_IDS);
    expect(
      [...workflowEntities].filter((entity) => !covered.has(entity)),
    ).toEqual([]);
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
    expect(rule.annotations?.["summary"]).toContain("$labels.friendly_name");
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
    expect(configuration).toContain(
      "select.dockstream_2_smart_fountain_water_dispensing_mode') != 'Flowing Water (Constant)'",
    );
  });
});
