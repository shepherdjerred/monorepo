import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeAssistantEventClient } from "@shepherdjerred/home-assistant";
import {
  PetCareHomeAssistantClient,
  parseLitterRobotDiagnostics,
  WhiskerDiagnosticsSchema,
} from "../clients/pet-care.ts";
import { renderPetCareMetrics } from "../pet-care-service.ts";
import type { PetCareCollection } from "../collectors/pets.ts";
import { collectPetCare } from "../collectors/pets.ts";
import { loadConfig } from "../config.ts";
import { healthyPetPayload } from "./pet-care-fixtures.ts";

const NOW = new Date("2026-08-30T08:30:00Z");

afterEach(() => {
  vi.restoreAllMocks();
});

function readyRobot() {
  return {
    type: "LR5_PRO",
    name: "Storage",
    updatedAt: "2026-08-30T08:22:06Z",
    nextFilterReplacementDate: "2026-09-26T03:00:32Z",
    hopperSettings: { mode: "Enabled" },
    state: {
      isOnline: true,
      lastSeen: "2026-08-30T08:21:53Z",
      statusIndicator: { title: "Ready", type: "READY" },
      dfiLevelPercent: 33,
      litterLevelPercent: 90.7,
      hopperLitterLevel: 1,
      hopperFault: "HopperFaultClear",
      hopperStatusIndicator: { title: "Ready", value: "READY" },
      isHopperInstalled: true,
      hopperStateLastUpdated: "2026-08-30T08:22:06Z",
      isLaserDirty: false,
      isBonnetRemoved: false,
      isDrawerRemoved: false,
      isDrawerFull: false,
      globeMotorFaultStatus: "MtrFaultClear",
      globeMotorRetractFaultStatus: "MtrFaultClear",
      pinchStatus: "Clear",
      isUsbFaultDetected: false,
      isGasSensorFaultDetected: false,
      displayCode: "DcModeIdle",
      odometerCleanCycles: 39,
    },
  };
}

function parseRobot(robot: unknown) {
  return parseLitterRobotDiagnostics(
    WhiskerDiagnosticsSchema.parse({ robots: [robot], pets: [] }),
    NOW,
    true,
  );
}

describe("LR5 Pro diagnostics", () => {
  it("does not classify an almost-full drawer advisory as a robot fault", () => {
    const base = readyRobot();
    const robot = parseRobot({
      ...base,
      state: {
        ...base.state,
        dfiLevelPercent: 73,
        statusIndicator: {
          title: "Drawer almost full",
          type: "DRAWER_ALMOST_FULL",
        },
      },
    });
    expect(robot).toMatchObject({
      ready: false,
      faulted: false,
      wastePercent: 73,
    });
  });
  it.each([
    "isLaserDirty",
    "isBonnetRemoved",
    "isDrawerRemoved",
    "isDrawerFull",
  ] as const)("an almost-full advisory does not hide %s", (fault) => {
    const base = readyRobot();
    const robot = parseRobot({
      ...base,
      state: {
        ...base.state,
        [fault]: true,
        statusIndicator: {
          title: "Drawer almost full",
          type: "DRAWER_ALMOST_FULL",
        },
      },
    });
    expect(robot.faulted).toBe(true);
  });
  it("keeps an unknown robot status actionable", () => {
    const base = readyRobot();
    expect(
      parseRobot({
        ...base,
        state: {
          ...base.state,
          statusIndicator: {
            title: "New provider status",
            type: "UNRECOGNIZED_STATUS",
          },
        },
      }).faulted,
    ).toBe(true);
  });
  it("uses the registry-associated vacuum availability rather than a fixed entity name", async () => {
    vi.spyOn(HomeAssistantEventClient.prototype, "connect").mockResolvedValue();
    vi.spyOn(HomeAssistantEventClient.prototype, "close").mockResolvedValue();
    const registry = vi
      .spyOn(HomeAssistantEventClient.prototype, "getEntityRegistry")
      .mockResolvedValue([
        {
          entity_id: "vacuum.renamed_lr5",
          unique_id: "robot",
          platform: "litterrobot",
          config_entry_id: "config-entry",
          device_id: null,
          area_id: null,
          name: null,
          original_name: null,
          disabled_by: null,
        },
      ]);
    let currentState = "docked";
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith("/api/states/vacuum.renamed_lr5")) {
          return Response.json({
            entity_id: "vacuum.renamed_lr5",
            state: currentState,
            attributes: {},
          });
        }
        if (url.endsWith("/api/diagnostics/config_entry/config-entry")) {
          return Response.json({
            home_assistant: {},
            custom_components: {},
            integration_manifest: {},
            setup_times: {},
            issues: [],
            data: { robots: [readyRobot()], pets: [] },
          });
        }
        throw new Error(`Unexpected request ${url}`);
      });
    const client = new PetCareHomeAssistantClient("http://ha.local", "test");
    const later = new Date("2026-08-30T12:00:00Z");
    const available = await client.getLitterRobot(later);
    expect(available.sourceFresh).toBe(true);
    currentState = "unavailable";
    const unavailable = await client.getLitterRobot(later);
    expect(unavailable.sourceFresh).toBe(false);
    expect(registry).toHaveBeenCalledOnce();
    expect(
      fetch.mock.calls
        .map(([input]) =>
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        )
        .some((url) => url.includes("vacuum.renamed_lr5")),
    ).toBe(true);
  });

  it("requests full history records for litter activity", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([
        [
          {
            entity_id: "sensor.storage_scoops_saved",
            state: "37",
            attributes: {},
          },
        ],
      ]),
    );
    const client = new PetCareHomeAssistantClient("http://ha.local", "token");

    await client.getHistory("sensor.storage_scoops_saved", NOW);

    const input = fetch.mock.calls[0]?.[0];
    if (input === undefined) {
      throw new Error("Expected Home Assistant history request");
    }
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    expect(url).toContain("significant_changes_only=true");
    expect(url).not.toContain("minimal_response");
  });
});

describe("LR5 Pro hopper diagnostics", () => {
  it.each([null, "HopperFaultClear"])(
    "parses a Ready hopper with fault field %s without a false fault",
    (hopperFault) => {
      const base = readyRobot();
      const robot = parseRobot({
        ...base,
        state: { ...base.state, hopperFault },
      });

      expect(robot).toMatchObject({
        ready: true,
        sourceFresh: true,
        litterPercent: 90.7,
        wastePercent: 33,
        hopperHealth: "ready",
        hopperLevelRaw: 1,
        faulted: false,
      });
    },
  );

  it.each(["MOTOR_FAULT_SHORT", "MOTOR_OT_AMPS", "MOTOR_DISCONNECTED"])(
    "preserves provider motor fault indicator %s despite a clear fault field",
    (value) => {
      const base = readyRobot();
      const robot = parseRobot({
        ...base,
        state: {
          ...base.state,
          hopperStatusIndicator: { value, title: value },
        },
      });

      expect(robot.hopperHealth).toBe("motor-fault");
    },
  );

  it.each(["HopperFaultUnrecognized", "HopperFaultClearUnknown"])(
    "does not treat unsupported fault value %s as healthy",
    (hopperFault) => {
      const base = readyRobot();
      const robot = parseRobot({
        ...base,
        state: { ...base.state, hopperFault },
      });

      expect(robot.hopperHealth).toBe("fault");
    },
  );

  it("keeps an offline device offline when its hopper reports clear", () => {
    const base = readyRobot();
    const robot = parseRobot({
      ...base,
      state: { ...base.state, isOnline: false },
    });

    expect(robot.online).toBe(false);
    expect(robot.hopperHealth).toBe("ready");
  });

  it.each([
    ["LOW", "Low", "low"],
    ["EMPTY", "Empty", "empty"],
    ["DISCONNECTED", "Disconnected", "disconnected"],
    ["JAMMED", "Jammed", "jammed"],
  ])("classifies hopper %s as %s", (value, title, expected) => {
    const base = readyRobot();
    const robot = parseRobot({
      ...base,
      state: {
        ...base.state,
        hopperStatusIndicator: { value, title },
      },
    });

    expect(robot.hopperHealth).toBe(expected);
  });

  it("classifies explicit hopper motor faults as critical state data", () => {
    const base = readyRobot();
    const robot = parseRobot({
      ...base,
      state: {
        ...base.state,
        hopperFault: "Hopper motor fault",
        hopperStatusIndicator: null,
      },
    });

    expect(robot.hopperHealth).toBe("motor-fault");
  });

  it.each(["CYCLING", "CAT_DETECTED", "LITTER_LOW"])(
    "does not classify normal %s activity as a robot fault",
    (type) => {
      const base = readyRobot();
      expect(
        parseRobot({
          ...base,
          state: { ...base.state, statusIndicator: { title: type, type } },
        }).faulted,
      ).toBe(false);
    },
  );

  it.each([
    "globeMotorFaultStatus",
    "globeMotorRetractFaultStatus",
    "pinchStatus",
  ])("still reports an explicit %s fault during normal activity", (field) => {
    const base = readyRobot();
    expect(
      parseRobot({
        ...base,
        state: {
          ...base.state,
          statusIndicator: { title: "Cycling", type: "CYCLING" },
          [field]: "Fault",
        },
      }).faulted,
    ).toBe(true);
  });

  it("keeps an unavailable hopper payload explicit", () => {
    const base = readyRobot();
    const robot = parseRobot({
      ...base,
      state: {
        ...base.state,
        hopperLitterLevel: null,
        hopperStatusIndicator: null,
      },
    });

    expect(robot.hopperHealth).toBe("unknown");
    expect(robot.hopperLevelRaw).toBeNull();
  });
});

describe("LR5 Pro source health", () => {
  it("keeps old device-change timestamps informational after a validated fetch", () => {
    const base = readyRobot();
    const robot = parseRobot({
      ...base,
      state: { ...base.state, lastSeen: "2026-08-30T07:00:00Z" },
    });

    expect(robot.sourceFresh).toBe(true);
    expect(robot.diagnosticsFetchedAt).toBe(NOW.toISOString());
    expect(robot.lastSeenAt).toBe("2026-08-30T07:00:00Z");
  });

  it("does not claim source health when the associated HA entity is unavailable", () => {
    const robot = parseLitterRobotDiagnostics(
      WhiskerDiagnosticsSchema.parse({ robots: [readyRobot()], pets: [] }),
      NOW,
      false,
    );
    expect(robot.sourceFresh).toBe(false);
    expect(robot.entityAvailable).toBe(false);
  });

  it("fails closed on malformed LR5 payloads", () => {
    expect(() => parseRobot({ type: "LR5_PRO", name: "Storage" })).toThrow(
      "Expected one valid LR5 Pro diagnostics record",
    );
  });
});

describe("pet-care metrics", () => {
  it("shows unavailable associated diagnostics as unknown before an alert fires", async () => {
    const robot = parseRobot(readyRobot());
    const collection = await collectPetCare(
      loadConfig({ TRMNL_API_KEY: "test", HA_TOKEN: "test" }),
      {
        homeAssistant: {
          getStates: async () => [],
          getHistory: async () => [],
          getLitterRobot: async () => ({
            ...robot,
            sourceFresh: false,
            entityAvailable: false,
          }),
        },
        alerts: { listOpen: async () => [] },
      },
      NOW,
    );
    expect(collection.payload.litter_robot?.status).toBe("unknown");
    expect(collection.payload.status).toBe("unknown");
  });
  it("exports safe LR5 values without calling the hopper level a percentage", () => {
    const robot = parseRobot(readyRobot());
    const collection: PetCareCollection = {
      payload: healthyPetPayload(),
      metrics: {
        sourceUp: { homeAssistant: true, whisker: true, alerts: true },
        litterRobot: robot,
        litterHaMismatch: false,
      },
    };

    const metrics = renderPetCareMetrics(collection);

    expect(metrics).toContain("trmnl_petcare_litter_percent 90.7");
    expect(metrics).toContain(
      'trmnl_petcare_litter_hopper_status{status="ready"} 1',
    );
    expect(metrics).toContain("trmnl_petcare_litter_hopper_level_raw 1");
    expect(metrics).not.toContain("hopper_percent");
    expect(metrics).toContain(
      `trmnl_petcare_whisker_last_success_timestamp_seconds ${String(NOW.getTime() / 1000)}`,
    );
  });

  it("retains only the fetch timestamp when diagnostics fail", () => {
    const collection: PetCareCollection = {
      payload: healthyPetPayload(),
      metrics: {
        sourceUp: { homeAssistant: true, whisker: false, alerts: true },
        litterRobot: null,
        litterHaMismatch: null,
      },
    };
    const metrics = renderPetCareMetrics(collection, NOW.toISOString());
    expect(metrics).toContain('trmnl_petcare_source_up{source="whisker"} 0');
    expect(metrics).toContain(
      "trmnl_petcare_whisker_last_success_timestamp_seconds",
    );
    expect(metrics).not.toContain("trmnl_petcare_litter_source_fresh ");
  });
});
