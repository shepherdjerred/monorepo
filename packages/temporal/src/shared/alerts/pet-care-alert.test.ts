import { describe, expect, test } from "vitest";
import { buildPetCareAlert, PET_CARE_ALERT_TTL_MS } from "./pet-care-alert.ts";

describe("pet-care Alertmanager alerts", () => {
  test("uses stable warning labels and a bounded firing lifetime", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    const alert = buildPetCareAlert(
      {
        entityId: "binary_sensor.litter_robot_problem",
        message: "Litter-Robot reports error 4",
        startedAtMs: Date.parse("2026-10-03T11:55:00.000Z"),
        resolved: false,
      },
      now,
    );

    expect(alert.labels).toEqual({
      alertname: "LitterRobotHomeAssistantProblem",
      severity: "warning",
      service: "pet-care",
      entity: "binary_sensor.litter_robot_problem",
    });
    expect(alert.annotations).toMatchObject({
      summary: "Litter-Robot needs attention",
      description: "Litter-Robot reports error 4",
    });
    expect(Date.parse(alert.endsAt) - now.getTime()).toBe(
      PET_CARE_ALERT_TTL_MS,
    );
  });

  test("resolves the same Alertmanager occurrence immediately", () => {
    const now = new Date("2026-10-03T12:10:00.000Z");
    const alert = buildPetCareAlert(
      {
        entityId: "binary_sensor.litter_robot_problem",
        message: "Ready again",
        startedAtMs: Date.parse("2026-10-03T11:55:00.000Z"),
        resolved: true,
      },
      now,
    );

    expect(alert.startsAt).toBe("2026-10-03T11:55:00.000Z");
    expect(alert.endsAt).toBe(now.toISOString());
  });
});
