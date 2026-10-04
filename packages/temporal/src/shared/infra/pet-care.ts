import { z } from "zod";

export const PET_CARE_SENSOR_ENTITY_IDS = [
  "binary_sensor.litter_robot_problem",
  "binary_sensor.litter_robot_stalled",
  "binary_sensor.petlibro_living_room_feeder_problem",
  "binary_sensor.petlibro_guest_room_feeder_problem",
  "binary_sensor.petlibro_fountain_water_low",
  "binary_sensor.petlibro_fountain_operation_problem",
] as const;

export const PetCareEntityIdSchema = z.enum(PET_CARE_SENSOR_ENTITY_IDS);

export const PET_CARE_SENSOR_POLICIES = {
  "binary_sensor.litter_robot_problem": {
    title: "Litter-Robot needs attention",
    alertName: "LitterRobotHomeAssistantProblem",
    holdMs: 5 * 60 * 1000,
  },
  "binary_sensor.litter_robot_stalled": {
    title: "Litter-Robot appears stalled",
    alertName: "LitterRobotStalled",
    holdMs: 45 * 60 * 1000,
  },
  "binary_sensor.petlibro_living_room_feeder_problem": {
    title: "Living Room PetLibro feeder needs attention",
    alertName: "PetLibroFeederLivingRoomProblem",
    holdMs: 5 * 60 * 1000,
  },
  "binary_sensor.petlibro_guest_room_feeder_problem": {
    title: "Guest Room PetLibro feeder needs attention",
    alertName: "PetLibroFeederGuestRoomProblem",
    holdMs: 5 * 60 * 1000,
  },
  "binary_sensor.petlibro_fountain_water_low": {
    title: "PetLibro fountain water shortage",
    alertName: "PetLibroFountainWaterLow",
    holdMs: 15 * 60 * 1000,
  },
  "binary_sensor.petlibro_fountain_operation_problem": {
    title: "PetLibro fountain operation problem",
    alertName: "PetLibroFountainOperationProblem",
    holdMs: 5 * 60 * 1000,
  },
} as const;

export type PetCareEntityId = z.infer<typeof PetCareEntityIdSchema>;

export type PetCareSensorUpdate = {
  entityId: string;
  state: string;
  detail: string;
  changedAtMs: number;
  updatedAtMs: number;
};

export type PetCareIncidentState = {
  state: string;
  detail: string;
  changedAtMs: number;
  updatedAtMs: number;
  onSinceMs?: number;
  incidentStartedAtMs?: number;
  notifiedDetail?: string;
  nextAlertRefreshAtMs?: number;
};

export function petCareHoldDeadline(
  entityId: PetCareEntityId,
  onSinceMs: number,
): number {
  return onSinceMs + PET_CARE_SENSOR_POLICIES[entityId].holdMs;
}

export function applyPetCareSensorUpdate(
  previous: PetCareIncidentState | undefined,
  update: PetCareSensorUpdate,
): PetCareIncidentState | undefined {
  if (previous !== undefined && update.updatedAtMs < previous.updatedAtMs) {
    return previous;
  }

  const changedAtMs =
    previous?.state === update.state
      ? previous.changedAtMs
      : update.changedAtMs;
  const next: PetCareIncidentState = {
    state: update.state,
    detail: update.detail,
    changedAtMs,
    updatedAtMs: update.updatedAtMs,
    ...(previous?.incidentStartedAtMs !== undefined && {
      incidentStartedAtMs: previous.incidentStartedAtMs,
    }),
    ...(previous?.notifiedDetail !== undefined && {
      notifiedDetail: previous.notifiedDetail,
    }),
    ...(previous?.nextAlertRefreshAtMs !== undefined && {
      nextAlertRefreshAtMs: previous.nextAlertRefreshAtMs,
    }),
  };

  if (update.state === "on") {
    next.onSinceMs =
      previous?.state === "on"
        ? (previous.onSinceMs ?? previous.changedAtMs)
        : changedAtMs;
  }
  return next;
}
