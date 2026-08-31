import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PetCareHomeAssistantClient,
  parseLitterRobotDiagnostics,
  WhiskerDiagnosticsSchema,
} from "../clients/pet-care.ts";
import { renderPetCareMetrics } from "../pet-care-service.ts";
import type { PetCareCollection } from "../collectors/pets.ts";
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
      hopperFault: null,
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
  );
}

describe("LR5 Pro diagnostics", () => {
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

  it("parses the healthy Ready payload and preserves the raw hopper indicator", () => {
    const robot = parseRobot(readyRobot());

    expect(robot).toMatchObject({
      ready: true,
      sourceFresh: true,
      litterPercent: 90.7,
      wastePercent: 33,
      hopperHealth: "ready",
      hopperLevelRaw: 1,
      faulted: false,
    });
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

  it("marks old last-seen data stale", () => {
    const base = readyRobot();
    const robot = parseRobot({
      ...base,
      state: { ...base.state, lastSeen: "2026-08-30T07:00:00Z" },
    });

    expect(robot.sourceFresh).toBe(false);
  });

  it("fails closed on malformed LR5 payloads", () => {
    expect(() => parseRobot({ type: "LR5_PRO", name: "Storage" })).toThrow(
      "Expected one valid LR5 Pro diagnostics record",
    );
  });
});

describe("pet-care metrics", () => {
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
  });
});
