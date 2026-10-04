import { describe, expect, test } from "vitest";
import {
  applyPetCareSensorUpdate,
  PET_CARE_SENSOR_POLICIES,
  petCareHoldDeadline,
  type PetCareIncidentState,
  type PetCareSensorUpdate,
} from "./pet-care.ts";

describe("pet-care Temporal policy", () => {
  test("keeps the agreed incident holds", () => {
    expect(
      Object.fromEntries(
        Object.entries(PET_CARE_SENSOR_POLICIES).map(([entityId, policy]) => [
          entityId,
          policy.holdMs,
        ]),
      ),
    ).toEqual({
      "binary_sensor.litter_robot_problem": 5 * 60_000,
      "binary_sensor.litter_robot_stalled": 45 * 60_000,
      "binary_sensor.petlibro_living_room_feeder_problem": 5 * 60_000,
      "binary_sensor.petlibro_guest_room_feeder_problem": 5 * 60_000,
      "binary_sensor.petlibro_fountain_water_low": 15 * 60_000,
      "binary_sensor.petlibro_fountain_operation_problem": 5 * 60_000,
    });
    expect(
      petCareHoldDeadline("binary_sensor.litter_robot_stalled", 1000),
    ).toBe(45 * 60_000 + 1000);
  });

  test("preserves the timer across details and cancels it on unknown state", () => {
    const initial: PetCareSensorUpdate = {
      entityId: "binary_sensor.petlibro_fountain_water_low",
      state: "on",
      detail: "Water is low",
      changedAtMs: 10_000,
      updatedAtMs: 10_000,
    };
    const pending = applyPetCareSensorUpdate(undefined, initial);
    expect(pending?.onSinceMs).toBe(10_000);

    const refreshed = applyPetCareSensorUpdate(pending, {
      ...initial,
      detail: "Water is still low",
      updatedAtMs: 11_000,
    });
    expect(refreshed?.onSinceMs).toBe(10_000);

    const activeIncident: PetCareIncidentState = {
      ...refreshed!,
      incidentStartedAtMs: 15_000,
      notifiedDetail: refreshed!.detail,
      nextAlertRefreshAtMs: 20_000,
    };
    const unknown = applyPetCareSensorUpdate(activeIncident, {
      ...initial,
      state: "unknown",
      detail: "Sensor unavailable",
      changedAtMs: 12_000,
      updatedAtMs: 12_000,
    });
    expect(unknown).toMatchObject({
      state: "unknown",
      incidentStartedAtMs: 15_000,
      nextAlertRefreshAtMs: 20_000,
    });
    expect(unknown?.onSinceMs).toBeUndefined();

    expect(
      applyPetCareSensorUpdate(unknown, {
        ...initial,
        state: "off",
        changedAtMs: 9000,
        updatedAtMs: 9000,
      }),
    ).toBe(unknown);
  });
});
