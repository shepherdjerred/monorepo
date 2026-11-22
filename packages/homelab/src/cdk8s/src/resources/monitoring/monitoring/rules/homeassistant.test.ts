import { Glob } from "bun";
import { describe, expect, test } from "vitest";
import {
  getHomeAssistantRuleGroups,
  HOME_ASSISTANT_KEEP_FIRING_FOR,
  HOME_ASSISTANT_OPS_ALERT_NAMES,
  TEMPORAL_AUTOMATION_ENTITY_IDS,
} from "./homeassistant.ts";
import { runPromtoolFixture } from "./platform/promtool-fixture.ts";

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
  test("leaves incident timing to Temporal and keeps maintenance thresholds", () => {
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
      fountainRules.find((rule) => rule.alert === "PetLibroFountainWaterLow"),
    ).toBeUndefined();
    expect(
      fountainRules.find(
        (rule) => rule.alert === "PetLibroFountainOperationProblem",
      ),
    ).toBeUndefined();
    expect(
      litterRules.find(
        (rule) => rule.alert === "LitterRobotHomeAssistantProblem",
      ),
    ).toBeUndefined();
    expect(
      litterRules.find((rule) => rule.alert === "LitterRobotStalled"),
    ).toBeUndefined();
    expect(
      litterRules.find((rule) => rule.alert === "LitterRobotLitterLow")?.expr
        .value,
    ).toBe("max by (namespace) (trmnl_petcare_litter_percent) < 60");
    expect(
      litterRules.find((rule) => rule.alert === "LitterRobotWasteHigh")?.expr
        .value,
    ).toBe(
      "max by (namespace) (trmnl_petcare_litter_waste_percent) > 60 and max by (namespace) (trmnl_petcare_litter_waste_percent) <= 80",
    );
    expect(
      litterRules.find((rule) => rule.alert === "LitterRobotWasteCritical")
        ?.expr.value,
    ).toBe("max by (namespace) (trmnl_petcare_litter_waste_percent) > 80");
    expect(
      litterRules.find((rule) => rule.alert === "LitterRobotFilterOverdue")
        ?.expr.value,
    ).toBe(
      "time() > max by (namespace) (trmnl_petcare_litter_filter_due_timestamp_seconds)",
    );

    const feederRules = groups.find(
      (group) => group.name === "homeassistant-petlibro-feeders",
    )?.rules;
    if (feederRules === undefined) throw new Error("Missing feeder rule group");
    expect(
      feederRules.some(
        (rule) => rule.alert === "PetLibroFeederLivingRoomProblem",
      ),
    ).toBe(false);
    expect(
      feederRules.some(
        (rule) => rule.alert === "PetLibroFeederGuestRoomProblem",
      ),
    ).toBe(false);
    expect(
      feederRules.some(
        (rule) => rule.alert === "PetLibroFeederLivingRoomBatteryProblem",
      ),
    ).toBe(true);
  });

  test("will not report hopper or robot fault states read from a stale source", () => {
    // The exporter holds the last known hopper and robot fault statuses when
    // Whisker stops answering, so an ungated rule pages for a fault the device
    // may already have cleared — observed live as HopperFault and
    // LitterRobotFault firing while source_fresh was 0.
    const groups = getHomeAssistantRuleGroups();
    const litterRules = groups.find(
      (group) => group.name === "homeassistant-litter-robot",
    )?.rules;
    if (litterRules === undefined) throw new Error("Missing litter rule group");

    for (const alert of [
      "LitterRobotHopperFault",
      "LitterRobotHopperLowOrDisconnected",
      "LitterRobotFault",
    ]) {
      expect(
        litterRules.find((rule) => rule.alert === alert)?.expr.value,
        alert,
      ).toContain(
        "and on (namespace) max by (namespace) (trmnl_petcare_litter_source_fresh) == 1",
      );
    }

    const litterFault = litterRules.find(
      (rule) => rule.alert === "LitterRobotFault",
    );
    expect(litterFault?.expr.value).toBe(
      'max by (namespace) (trmnl_petcare_litter_fault == 1 or trmnl_petcare_litter_online == 0 or trmnl_petcare_litter_hopper_installed == 0 or trmnl_petcare_litter_hopper_enabled == 0) and on (namespace) max by (namespace) (trmnl_petcare_litter_source_fresh) == 1 unless on () (max(homeassistant_binary_sensor_state{entity="binary_sensor.litter_robot_problem"}) == 1)',
    );
    expect(litterFault?.for).toBe("15m");

    const cleanWaterEmpty = groups
      .find((group) => group.name === "homeassistant-roborock")
      ?.rules?.find((rule) => rule.alert === "RoborockCleanWaterTankEmpty");
    expect(cleanWaterEmpty?.for).toBe("15m");

    // Staleness stays the business of the rule that owns it, so the same
    // condition is not reported twice.
    expect(
      litterRules.find((rule) => rule.alert === "LitterRobotDiagnosticsStale")
        ?.expr.value,
    ).toContain("trmnl_petcare_litter_source_fresh == 0");
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
});

// Split from the pet-care rules above only to stay within the per-function
// line budget; these cover the rest of the Home Assistant surface.
describe("Home Assistant rules — environment and automation dependencies", () => {
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

  test("gates Roborock vacuum problem templates on upstream availability and checks physical fault states", async () => {
    const configuration = await Bun.file(
      new URL(
        "../../../../../config/homeassistant/configuration.yaml",
        import.meta.url,
      ),
    ).text();

    for (const floor of ["1st", "2nd", "3rd"]) {
      expect(configuration).toContain(`has_value('vacuum.${floor}_floor')`);
      expect(configuration).toContain(
        `has_value('sensor.${floor}_floor_status')`,
      );
      expect(configuration).toContain(
        `has_value('sensor.${floor}_floor_vacuum_error')`,
      );
      expect(configuration).toContain(
        `has_value('sensor.${floor}_floor_dock_dock_error')`,
      );
      expect(configuration).toContain(
        `states('vacuum.${floor}_floor') == 'error'`,
      );
      expect(configuration).toContain(
        `states('sensor.${floor}_floor_status') in ['error', 'charging_problem']`,
      );
      expect(configuration).toContain(
        `states('sensor.${floor}_floor_vacuum_error') not in ['none', 'low_battery', 'robot_on_carpet']`,
      );
      expect(configuration).toContain(
        `states('sensor.${floor}_floor_dock_dock_error') not in ['ok', 'water_empty', 'waste_water_tank_full']`,
      );
      expect(configuration).not.toContain(
        `states('sensor.${floor}_floor_dock_dock_error') != 'ok'`,
      );
      expect(configuration).not.toContain(
        `states('vacuum.${floor}_floor') in ['error', 'unknown', 'unavailable']`,
      );
    }
    expect(configuration).toContain(
      "select.dockstream_2_smart_fountain_water_dispensing_mode') != 'Flowing Water (Constant)'",
    );
    expect(configuration).toContain("has_value('sensor.storage_status_code')");
    expect(configuration).not.toContain(
      "if states('sensor.storage_status_code') in ['rdy'",
    );
  });
});

describe("Home Assistant pet-care fan-out and feeder battery rules", () => {
  test("keeps parent vacuum availability unconditional and gates child floor entities on parent availability", () => {
    const availabilityRules =
      getHomeAssistantRuleGroups().find(
        (group) => group.name === "homeassistant-availability",
      )?.rules ?? [];
    const petAvailability = availabilityRules.filter(
      (rule) => rule.alert === "PetCareEntityUnavailable",
    );

    for (const floor of ["1st", "2nd", "3rd"]) {
      const parentEntity = `vacuum.${floor}_floor`;
      const parentRule = petAvailability.find(
        (rule) => rule.labels?.["entity"] === parentEntity,
      );
      expect(parentRule?.expr.value).toBe(
        `homeassistant_entity_available{entity="${parentEntity}"} == 0 or absent(homeassistant_entity_available{entity="${parentEntity}"})`,
      );

      const childRules = petAvailability.filter((rule) => {
        const entity = rule.labels?.["entity"] ?? "";
        return (
          entity.startsWith(`sensor.${floor}_floor_`) ||
          entity.startsWith(`binary_sensor.${floor}_floor_`)
        );
      });
      expect(childRules).toHaveLength(13);
      for (const childRule of childRules) {
        const entity = childRule.labels?.["entity"] ?? "";
        expect(childRule.expr.value).toBe(
          `(homeassistant_entity_available{entity="${entity}"} == 0 or absent(homeassistant_entity_available{entity="${entity}"})) and on() (homeassistant_entity_available{entity="${parentEntity}"} == 1)`,
        );
      }
    }
  });

  test("monitors PetLibro feeder D-cell battery_ac <= 20% for 2h without double-paging HomeAssistantBatteryLow", () => {
    const groups = getHomeAssistantRuleGroups();
    const feederRules =
      groups.find((group) => group.name === "homeassistant-petlibro-feeders")
        ?.rules ?? [];
    const availabilityRules =
      groups.find((group) => group.name === "homeassistant-availability")
        ?.rules ?? [];
    const batteryLow = groups
      .find((group) => group.name === "homeassistant-batteries")
      ?.rules?.find((rule) => rule.alert === "HomeAssistantBatteryLow");

    const livingRoomBattery = feederRules.find(
      (rule) => rule.alert === "PetLibroFeederLivingRoomBatteryProblem",
    );
    const guestRoomBattery = feederRules.find(
      (rule) => rule.alert === "PetLibroFeederGuestRoomBatteryProblem",
    );
    expect(livingRoomBattery?.expr.value).toBe(
      'homeassistant_sensor_battery_percent{entity="sensor.granary_smart_camera_feeder_battery_ac"} <= 20',
    );
    expect(livingRoomBattery?.for).toBe("2h");
    expect(livingRoomBattery?.annotations?.["summary"]).toBe(
      "Living Room PetLibro feeder backup battery is low",
    );
    expect(guestRoomBattery?.expr.value).toBe(
      'homeassistant_sensor_battery_percent{entity="sensor.granary_smart_camera_feeder_battery_ac_2"} <= 20',
    );
    expect(guestRoomBattery?.for).toBe("2h");

    const petEntities = new Set(
      availabilityRules
        .filter((rule) => rule.alert === "PetCareEntityUnavailable")
        .map((rule) => rule.labels?.["entity"]),
    );
    expect(
      petEntities.has("sensor.granary_smart_camera_feeder_battery_ac"),
    ).toBe(true);
    expect(
      petEntities.has("sensor.granary_smart_camera_feeder_battery_ac_2"),
    ).toBe(true);
    expect(
      petEntities.has(
        "binary_sensor.granary_smart_camera_feeder_battery_status",
      ),
    ).toBe(false);
    expect(batteryLow?.expr.value).toContain(
      'entity!~"sensor[.]granary_smart_camera_feeder_battery_ac(_2)?"',
    );
  });

  test("evaluates Roborock fan-out suppression and PetLibro battery exclusion in promtool", async () => {
    const groups = getHomeAssistantRuleGroups();
    const availabilityRules =
      groups.find((group) => group.name === "homeassistant-availability")
        ?.rules ?? [];
    const parentExpr = availabilityRules.find(
      (rule) =>
        rule.alert === "PetCareEntityUnavailable" &&
        rule.labels?.["entity"] === "vacuum.1st_floor",
    )?.expr.value;
    const childExpr = availabilityRules.find(
      (rule) =>
        rule.alert === "PetCareEntityUnavailable" &&
        rule.labels?.["entity"] === "sensor.1st_floor_status",
    )?.expr.value;
    const batteryLowExpr = groups
      .find((group) => group.name === "homeassistant-batteries")
      ?.rules?.find((rule) => rule.alert === "HomeAssistantBatteryLow")
      ?.expr.value;
    const feederBatteryExpr = groups
      .find((group) => group.name === "homeassistant-petlibro-feeders")
      ?.rules?.find(
        (rule) => rule.alert === "PetLibroFeederLivingRoomBatteryProblem",
      )?.expr.value;

    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          input_series: [
            {
              series:
                'homeassistant_entity_available{entity="vacuum.1st_floor"}',
              values: "0x20",
            },
            {
              series:
                'homeassistant_entity_available{entity="sensor.1st_floor_status"}',
              values: "0x20",
            },
          ],
          promql_expr_test: [
            {
              expr: parentExpr,
              eval_time: "20m",
              exp_samples: [
                {
                  labels:
                    'homeassistant_entity_available{entity="vacuum.1st_floor"}',
                  value: 0,
                },
              ],
            },
            {
              expr: childExpr,
              eval_time: "20m",
              exp_samples: [],
            },
          ],
        },
        {
          interval: "1m",
          input_series: [
            {
              series:
                'homeassistant_entity_available{entity="vacuum.1st_floor"}',
              values: "1x20",
            },
          ],
          promql_expr_test: [
            {
              expr: childExpr,
              eval_time: "20m",
              exp_samples: [
                { labels: '{entity="sensor.1st_floor_status"}', value: 1 },
              ],
            },
          ],
        },
        {
          interval: "1m",
          input_series: [
            {
              series:
                'homeassistant_sensor_battery_percent{entity="sensor.granary_smart_camera_feeder_battery_ac"}',
              values: "10x20",
            },
            {
              series:
                'homeassistant_sensor_battery_percent{entity="sensor.front_door_battery"}',
              values: "15x20",
            },
          ],
          promql_expr_test: [
            {
              expr: feederBatteryExpr,
              eval_time: "20m",
              exp_samples: [
                {
                  labels:
                    'homeassistant_sensor_battery_percent{entity="sensor.granary_smart_camera_feeder_battery_ac"}',
                  value: 10,
                },
              ],
            },
            {
              expr: batteryLowExpr,
              eval_time: "20m",
              exp_samples: [
                { labels: '{entity="sensor.front_door_battery"}', value: 15 },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe("Home Assistant LR5 pod rollout and fault deduplication", () => {
  test("collapses LR5 pod rollouts by namespace and suppresses LitterRobotFault when HA problem is active", async () => {
    const litterRules =
      getHomeAssistantRuleGroups().find(
        (group) => group.name === "homeassistant-litter-robot",
      )?.rules ?? [];
    const faultExpr = litterRules.find(
      (rule) => rule.alert === "LitterRobotFault",
    )?.expr.value;
    const wasteExpr = litterRules.find(
      (rule) => rule.alert === "LitterRobotWasteCritical",
    )?.expr.value;

    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          input_series: [
            {
              series:
                'trmnl_petcare_litter_fault{namespace="trmnl-dashboard",pod="pod-a"}',
              values: "1x20",
            },
            {
              series:
                'trmnl_petcare_litter_fault{namespace="trmnl-dashboard",pod="pod-b"}',
              values: "1x20",
            },
            {
              series:
                'trmnl_petcare_litter_source_fresh{namespace="trmnl-dashboard",pod="pod-a"}',
              values: "1x20",
            },
            {
              series:
                'trmnl_petcare_litter_waste_percent{namespace="trmnl-dashboard",pod="pod-a"}',
              values: "90x20",
            },
            {
              series:
                'trmnl_petcare_litter_waste_percent{namespace="trmnl-dashboard",pod="pod-b"}',
              values: "90x20",
            },
            {
              series:
                'homeassistant_binary_sensor_state{entity="binary_sensor.litter_robot_problem"}',
              values: "1x20",
            },
          ],
          promql_expr_test: [
            { expr: faultExpr, eval_time: "20m", exp_samples: [] },
            {
              expr: wasteExpr,
              eval_time: "20m",
              exp_samples: [
                { labels: '{namespace="trmnl-dashboard"}', value: 90 },
              ],
            },
          ],
        },
        {
          interval: "1m",
          input_series: [
            {
              series:
                'trmnl_petcare_litter_hopper_enabled{namespace="trmnl-dashboard",pod="pod-a"}',
              values: "0x20",
            },
            {
              series:
                'trmnl_petcare_litter_source_fresh{namespace="trmnl-dashboard",pod="pod-a"}',
              values: "1x20",
            },
            {
              series:
                'homeassistant_binary_sensor_state{entity="binary_sensor.litter_robot_problem"}',
              values: "0x20",
            },
          ],
          promql_expr_test: [
            {
              expr: faultExpr,
              eval_time: "20m",
              exp_samples: [
                { labels: '{namespace="trmnl-dashboard"}', value: 0 },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe("Home Assistant alert category", () => {
  test("splits household chores from Ops integration health and holds household rules across Recreate restarts", () => {
    const rules = getHomeAssistantRuleGroups().flatMap(
      (group) => group.rules ?? [],
    );
    const alerts = rules.filter((rule) => rule.alert !== undefined);
    expect(alerts.length).toBeGreaterThan(0);

    expect([...HOME_ASSISTANT_OPS_ALERT_NAMES]).toEqual([
      "HomeAssistantAutomationDependencyUnavailable",
      "PetCareEntityUnavailable",
      "LitterRobotDiagnosticsStale",
      "LitterRobotEntitiesStale",
    ]);

    for (const rule of alerts) {
      expect(rule.labels?.["severity"], rule.alert).toBeDefined();
      if (HOME_ASSISTANT_OPS_ALERT_NAMES.has(rule.alert ?? "")) {
        expect(rule.labels?.["category"], rule.alert).toBeUndefined();
        expect(rule.keepFiringFor, rule.alert).toBeUndefined();
      } else {
        expect(rule.labels?.["category"], rule.alert).toBe("household");
        expect(rule.keepFiringFor, rule.alert).toBe(
          HOME_ASSISTANT_KEEP_FIRING_FOR,
        );
      }
    }

    // Per-entity availability alerts keep their entity label and omit household category.
    const petEntityRule = alerts.find(
      (rule) => rule.alert === "PetCareEntityUnavailable",
    );
    expect(petEntityRule?.labels).toMatchObject({ severity: "warning" });
    expect(petEntityRule?.labels?.["entity"]).toBeDefined();
    expect(petEntityRule?.labels?.["category"]).toBeUndefined();

    for (const name of [
      "LitterRobotFilterOverdue",
      "HomeAssistantBatteryLow",
      "RoborockConsumableDue",
      "PetLibroFeederLivingRoomDesiccantDue",
    ]) {
      const rule = alerts.find((candidate) => candidate.alert === name);
      expect(rule?.labels?.["category"], name).toBe("household");
      expect(rule?.keepFiringFor, name).toBe("15m");
    }
    for (const record of rules.filter((rule) => rule.record !== undefined)) {
      expect(record.labels?.["category"], record.record).toBeUndefined();
    }
  });
});

describe("Home Assistant prometheus exporter", () => {
  test("excludes stateless domains from availability inventory", async () => {
    const configuration = await Bun.file(
      new URL(
        "../../../../../config/homeassistant/configuration.yaml",
        import.meta.url,
      ),
    ).text();

    expect(configuration).not.toContain("unavailable_entities_count");
    const prometheus = configuration
      .split("prometheus:")[1]
      ?.split("\nlight:")[0];
    expect(prometheus).toBeDefined();
    expect(prometheus).toContain("exclude_domains:");
    for (const domain of ["button", "event", "conversation", "stt", "tts"]) {
      expect(prometheus).toContain(`- ${domain}`);
    }
    const automationDomains = new Set(
      TEMPORAL_AUTOMATION_ENTITY_IDS.flatMap((entity) => {
        const domain = entity.split(".", 1)[0];
        return domain === undefined ? [] : [domain];
      }),
    );
    for (const domain of automationDomains) {
      expect(prometheus).not.toContain(`- ${domain}`);
    }
  });
});
