import {
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import type { HaActivities } from "#activities/ha.ts";
import type { PetCareAlertActivities } from "#activities/pet-care-alerts.ts";
import {
  PET_CARE_ALERT_REFRESH_MS,
  type PetCareAlertInput,
} from "#shared/alerts/pet-care-alert.ts";
import {
  applyPetCareSensorUpdate,
  petCareHoldDeadline,
  PET_CARE_SENSOR_ENTITY_IDS,
  PET_CARE_SENSOR_POLICIES,
  PetCareEntityIdSchema,
  type PetCareEntityId,
  type PetCareIncidentState,
  type PetCareSensorUpdate,
} from "#shared/infra/pet-care.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const haActivities = proxyActivities<HaActivities>({
  taskQueue: TASK_QUEUES.HOME,
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "15 minutes",
  },
});

const alertActivities = proxyActivities<PetCareAlertActivities>({
  taskQueue: TASK_QUEUES.REPORTS,
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "15 minutes",
  },
});

export type PetCareAlertsState = Partial<
  Record<PetCareEntityId, PetCareIncidentState>
>;

export const petCareSensorChanged = defineSignal<[PetCareSensorUpdate]>(
  "petCareSensorChanged",
);

function alertInput(
  entityId: PetCareEntityId,
  state: PetCareIncidentState,
  resolved: boolean,
): PetCareAlertInput {
  return {
    entityId,
    message: state.detail,
    startedAtMs: state.incidentStartedAtMs ?? state.changedAtMs,
    resolved,
  };
}

export async function petCareAlerts(
  initialState: PetCareAlertsState = {},
): Promise<never> {
  const states: PetCareAlertsState = { ...initialState };
  let revision = 0;

  setHandler(petCareSensorChanged, (update) => {
    const parsedEntityId = PetCareEntityIdSchema.safeParse(update.entityId);
    if (!parsedEntityId.success) return;
    const entityId = parsedEntityId.data;
    const previous = states[entityId];
    const next = applyPetCareSensorUpdate(previous, update);
    if (next === undefined || next === previous) return;
    states[entityId] = next;
    revision += 1;
  });

  for (;;) {
    let nextDeadlineMs: number | undefined;
    const now = Date.now();

    for (const entityId of PET_CARE_SENSOR_ENTITY_IDS) {
      const state = states[entityId];
      if (state === undefined) continue;
      const deadline = await processPetCareState(entityId, state, now);
      if (deadline !== undefined) {
        nextDeadlineMs = Math.min(nextDeadlineMs ?? deadline, deadline);
      }
    }

    if (workflowInfo().continueAsNewSuggested) {
      return continueAsNew<typeof petCareAlerts>(states);
    }

    const observedRevision = revision;
    const shouldWake = () =>
      revision !== observedRevision || workflowInfo().continueAsNewSuggested;
    if (nextDeadlineMs === undefined) {
      await condition(shouldWake);
    } else {
      await condition(shouldWake, Math.max(1, nextDeadlineMs - Date.now()));
    }
  }
}

async function processPetCareState(
  entityId: PetCareEntityId,
  state: PetCareIncidentState,
  now: number,
): Promise<number | undefined> {
  const policy = PET_CARE_SENSOR_POLICIES[entityId];
  if (state.incidentStartedAtMs !== undefined) {
    if (state.state === "off") {
      await haActivities.setPetCareNotification({
        entityId,
        title: policy.title,
        message: state.detail,
        active: false,
        sendPush: false,
      });
      await alertActivities.publishPetCareAlert(
        alertInput(entityId, state, true),
      );
      delete state.incidentStartedAtMs;
      delete state.notifiedDetail;
      delete state.nextAlertRefreshAtMs;
      return undefined;
    }

    if (state.notifiedDetail !== state.detail) {
      await haActivities.setPetCareNotification({
        entityId,
        title: policy.title,
        message: state.detail,
        active: true,
        sendPush: false,
      });
      await alertActivities.publishPetCareAlert(
        alertInput(entityId, state, false),
      );
      state.notifiedDetail = state.detail;
    }

    if (
      state.nextAlertRefreshAtMs === undefined ||
      state.nextAlertRefreshAtMs <= now
    ) {
      await alertActivities.publishPetCareAlert(
        alertInput(entityId, state, false),
      );
      state.nextAlertRefreshAtMs = Date.now() + PET_CARE_ALERT_REFRESH_MS;
    }
    return state.nextAlertRefreshAtMs;
  }

  delete state.onSinceMs;
  if (state.state !== "on") return undefined;
  const dueAtMs = petCareHoldDeadline(entityId, state.changedAtMs);
  state.onSinceMs = state.changedAtMs;
  if (dueAtMs > now) return dueAtMs;

  state.incidentStartedAtMs = dueAtMs;
  await haActivities.setPetCareNotification({
    entityId,
    title: policy.title,
    message: state.detail,
    active: true,
    sendPush: true,
  });
  await alertActivities.publishPetCareAlert(alertInput(entityId, state, false));
  state.notifiedDetail = state.detail;
  state.nextAlertRefreshAtMs = Date.now() + PET_CARE_ALERT_REFRESH_MS;
  return state.nextAlertRefreshAtMs;
}
