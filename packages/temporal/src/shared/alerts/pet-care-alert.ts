import type { AlertmanagerAlert } from "#lib/alertmanager.ts";
import {
  PET_CARE_SENSOR_POLICIES,
  type PetCareEntityId,
} from "#shared/infra/pet-care.ts";

export const PET_CARE_ALERT_TTL_MS = 8 * 24 * 60 * 60 * 1000;
export const PET_CARE_ALERT_REFRESH_MS = PET_CARE_ALERT_TTL_MS / 2;

export type PetCareAlertInput = {
  entityId: PetCareEntityId;
  message: string;
  startedAtMs: number;
  resolved: boolean;
};

export function buildPetCareAlert(
  input: PetCareAlertInput,
  now: Date,
): AlertmanagerAlert {
  const policy = PET_CARE_SENSOR_POLICIES[input.entityId];
  return {
    labels: {
      alertname: policy.alertName,
      severity: "warning",
      service: "pet-care",
      entity: input.entityId,
    },
    annotations: {
      summary: policy.title,
      description: input.message,
      message: input.message,
    },
    startsAt: new Date(input.startedAtMs).toISOString(),
    endsAt: new Date(
      now.getTime() + (input.resolved ? 0 : PET_CARE_ALERT_TTL_MS),
    ).toISOString(),
    generatorURL: "https://github.com/shepherdjerred/monorepo",
  };
}
