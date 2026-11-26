import { z } from "zod";
import type { Client } from "@temporalio/client";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import type { Duration } from "@temporalio/common";
import type {
  EntityState,
  EventEnvelope,
  HomeAssistantRestClient,
} from "@shepherdjerred/home-assistant";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  MOTION_LIGHT_ROOMS,
  type MotionLightRoom,
} from "#shared/infra/motion-light.ts";
import { cooldownBucket, isConfirmedAway } from "#shared/infra/presence.ts";
import {
  PetCareEntityIdSchema,
  PET_CARE_SENSOR_POLICIES,
  type PetCareSensorUpdate,
} from "#shared/infra/pet-care.ts";
import {
  firstUnavailableRoborock,
  ROBOROCK_VACUUM_ENTITIES,
} from "#shared/infra/roborock.ts";

const IOS_ACTION_ID_GOOD_NIGHT = "A91A15AA-479E-416C-8F51-BD983A999266";

const IosActionEventData = z.object({
  actionID: z.string(),
});

const StateChangedEventData = z.object({
  entity_id: z.string(),
  new_state: z
    .object({
      state: z.string(),
      attributes: z.record(z.string(), z.unknown()).optional(),
      last_changed: z.string().optional(),
      last_updated: z.string().optional(),
    })
    .loose()
    .nullable()
    .optional(),
  old_state: z.object({ state: z.string() }).loose().nullable().optional(),
});

const PERSON_ENTITIES = ["person.jerred", "person.shuxin"] as const;
const PERSON_ENTITY_SET = new Set<string>(PERSON_ENTITIES);
const ROBOROCK_VACUUM_ENTITY_SET = new Set<string>(ROBOROCK_VACUUM_ENTITIES);
const MOTION_LIGHT_ROOMS_BY_ENTITY = new Map<
  string,
  {
    room: MotionLightRoom;
    lightEntityId: string;
  }
>([
  [
    MOTION_LIGHT_ROOMS.laundry.motionEntityId,
    {
      room: "laundry",
      lightEntityId: MOTION_LIGHT_ROOMS.laundry.lightEntityId,
    },
  ],
  [
    MOTION_LIGHT_ROOMS.storage.motionEntityId,
    {
      room: "storage",
      lightEntityId: MOTION_LIGHT_ROOMS.storage.lightEntityId,
    },
  ],
]);

// Singleton id for the debounced front-door lock reconciler. Every presence
// transition signals this one workflow (starting it if needed) rather than
// spawning per-edge lock/unlock workflows, so a flapping sensor can never make
// the bolt cycle. See workflows/ha/reconcile-lock.ts.
const RECONCILE_LOCK_WORKFLOW_ID = "reconcile-lock";
const RECONCILE_CLIMATE_WORKFLOW_ID = "reconcile-climate";
const PRESENCE_CHANGED_SIGNAL = "presenceChanged";
const RECONCILE_ROBOROCK_WORKFLOW_ID = "reconcile-roborock";
const ROBOROCK_UNAVAILABLE_SIGNAL = "roborockUnavailable";
const PET_CARE_WORKFLOW_ID = "pet-care-alerts";
const PET_CARE_SENSOR_CHANGED_SIGNAL = "petCareSensorChanged";

function timestampMs(value: string | undefined): number {
  if (value === undefined) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

async function signalSingletonWorkflow(
  client: Client,
  workflowType: string,
  options: {
    workflowId: string;
    signal: string;
    signalArgs: unknown[];
    workflowExecutionTimeout?: Duration;
  },
  failureTarget: string,
): Promise<void> {
  try {
    await client.workflow.signalWithStart(workflowType, {
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowId: options.workflowId,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
      ...(options.workflowExecutionTimeout !== undefined && {
        workflowExecutionTimeout: options.workflowExecutionTimeout,
      }),
      signal: options.signal,
      signalArgs: options.signalArgs,
    });
  } catch (error: unknown) {
    // Fail fast: surface the failure instead of silently proceeding with HA
    // state un-reconciled. The HA event client wraps handlers in
    // `Promise.resolve(handler()).catch(emitError)`, so this propagates as a
    // logged subscription error rather than crashing the worker.
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Failed to signal ${failureTarget}: ${detail}`);
    throw error;
  }
}

async function signalPetCareState(
  client: Client,
  update: PetCareSensorUpdate,
): Promise<void> {
  await signalSingletonWorkflow(
    client,
    "petCareAlerts",
    {
      workflowId: PET_CARE_WORKFLOW_ID,
      signal: PET_CARE_SENSOR_CHANGED_SIGNAL,
      signalArgs: [update],
    },
    `petCareAlerts for ${update.entityId}`,
  );
}

function petCareUpdateFromState(
  entityId: string,
  state:
    | {
        state: string;
        attributes?: Record<string, unknown> | undefined;
        last_changed?: string | undefined;
        last_updated?: string | undefined;
      }
    | null
    | undefined,
): PetCareSensorUpdate {
  const changedAtMs = timestampMs(state?.last_changed);
  const updatedAtMs = timestampMs(state?.last_updated ?? state?.last_changed);
  const parsedEntityId = PetCareEntityIdSchema.safeParse(entityId);
  const policy = parsedEntityId.success
    ? PET_CARE_SENSOR_POLICIES[parsedEntityId.data]
    : undefined;
  const detail = state?.attributes?.["problem_detail"];
  return {
    entityId,
    state: state?.state ?? "unavailable",
    detail:
      typeof detail === "string" && detail.trim() !== ""
        ? detail
        : (policy?.title ?? entityId),
    changedAtMs,
    updatedAtMs,
  };
}

/** Reconcile current HA states after subscription startup or WebSocket reconnect. */
export async function syncPetCareStates(
  client: Client,
  rest: HomeAssistantRestClient,
): Promise<void> {
  const states = await rest.getStates();
  const statesById = new Map(states.map((state) => [state.entity_id, state]));
  for (const entityId of Object.keys(PET_CARE_SENSOR_POLICIES)) {
    await signalPetCareState(
      client,
      petCareUpdateFromState(entityId, statesById.get(entityId)),
    );
  }
}

async function signalRoborockReconciler(client: Client): Promise<void> {
  await signalSingletonWorkflow(
    client,
    "reconcileRoborock",
    {
      workflowId: RECONCILE_ROBOROCK_WORKFLOW_ID,
      workflowExecutionTimeout: "60 minutes",
      signal: ROBOROCK_UNAVAILABLE_SIGNAL,
      signalArgs: [],
    },
    "reconcileRoborock",
  );
}

/** Reconcile current Roborock availability after startup or WebSocket reconnect. */
export async function syncRoborockStates(
  client: Client,
  rest: HomeAssistantRestClient,
): Promise<void> {
  const states = await rest.getStates();
  if (firstUnavailableRoborock(states) !== undefined) {
    await signalRoborockReconciler(client);
  }
}

async function bumpLockReconciler(client: Client): Promise<void> {
  await signalSingletonWorkflow(
    client,
    "reconcileLock",
    {
      workflowId: RECONCILE_LOCK_WORKFLOW_ID,
      workflowExecutionTimeout: "30 minutes",
      signal: PRESENCE_CHANGED_SIGNAL,
      signalArgs: [],
    },
    "reconcileLock",
  );
}

/** Re-apply occupied climate after a presence edge, startup, or reconnect. */
export async function signalClimateReconciler(client: Client): Promise<void> {
  await signalSingletonWorkflow(
    client,
    "reconcileClimate",
    {
      workflowId: RECONCILE_CLIMATE_WORKFLOW_ID,
      workflowExecutionTimeout: "10 minutes",
      signal: PRESENCE_CHANGED_SIGNAL,
      signalArgs: [],
    },
    "reconcileClimate",
  );
}

function dayKey(): string {
  const now = new Date();
  return `${String(now.getUTCFullYear())}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
}

async function startWorkflow(
  client: Client,
  workflowType: string,
  workflowId: string,
  options: {
    args?: unknown[];
    workflowIdReusePolicy?: WorkflowIdReusePolicy;
    workflowIdConflictPolicy?: WorkflowIdConflictPolicy;
    workflowExecutionTimeout?: Duration;
  } = {},
): Promise<void> {
  try {
    await client.workflow.start(workflowType, {
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowId,
      workflowIdReusePolicy:
        options.workflowIdReusePolicy ?? WorkflowIdReusePolicy.ALLOW_DUPLICATE,
      ...(options.workflowIdConflictPolicy !== undefined && {
        workflowIdConflictPolicy: options.workflowIdConflictPolicy,
      }),
      workflowExecutionTimeout:
        options.workflowExecutionTimeout ?? "10 minutes",
      args: options.args ?? [],
    });
    console.warn(`Started workflow ${workflowType} id=${workflowId}`);
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      // Expected for HA-presence cooldown: a duplicate transition fired
      // inside the same bucket. Suppressed at the server, surfaced as info.
      console.warn(
        JSON.stringify({
          level: "info",
          msg: `${workflowType} debounced: duplicate start in same cooldown bucket`,
          component: "ha-presence",
          phase: "debounced",
          workflowType,
          workflowId,
        }),
      );
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `Failed to start workflow ${workflowType} id=${workflowId}: ${detail}`,
    );
  }
}

// True if every person except `transitioningEntityId` is `not_home`, i.e.
// the transitioning person is alone on their side of the home/not-home split.
// welcomeHome fires on first-arrival (others all away → house was empty).
// leavingHome fires on last-departure (others all away → house is now empty).
async function othersAllAway(
  rest: HomeAssistantRestClient,
  transitioningEntityId: string,
): Promise<boolean> {
  const others = PERSON_ENTITIES.filter((e) => e !== transitioningEntityId);
  const states: EntityState[] = await Promise.all(
    others.map((e) => rest.getState(e)),
  );
  return states.every((s) => isConfirmedAway(s.state));
}

export function handleIosAction(
  client: Client,
): (event: EventEnvelope) => Promise<void> {
  return async (event) => {
    const parsed = IosActionEventData.safeParse(event.data);
    if (!parsed.success) {
      return;
    }
    if (parsed.data.actionID !== IOS_ACTION_ID_GOOD_NIGHT) {
      return;
    }
    await startWorkflow(client, "goodNight", `good-night-${dayKey()}`);
  };
}

async function handlePersonTransition(
  client: Client,
  rest: HomeAssistantRestClient,
  transition: { entityId: string; oldState: string; newState: string },
): Promise<void> {
  const { entityId, oldState, newState } = transition;
  // Every presence transition (both directions) re-arms the debounced lock
  // reconciler; it decides lock/unlock from settled, live state.
  await bumpLockReconciler(client);
  await signalClimateReconciler(client);

  if (oldState === "not_home" && newState === "home") {
    // Fire on every arrival so the door is always unlocked and lights come
    // on, even if someone else is already home. `firstArrival` (the house was
    // otherwise empty) gates the welcome notification and vacuum docking.
    const firstArrival = await othersAllAway(rest, entityId);
    await startWorkflow(
      client,
      "welcomeHome",
      `welcome-home-${cooldownBucket()}-${entityId}`,
      {
        args: [firstArrival],
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
      },
    );
    return;
  }
  if (oldState === "home" && newState === "not_home") {
    if (!(await othersAllAway(rest, entityId))) {
      console.warn(
        `leavingHome skipped: ${entityId} left but others are still home`,
      );
      return;
    }
    await startWorkflow(
      client,
      "leavingHome",
      `leaving-home-${cooldownBucket()}-${entityId}`,
      {
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
        // leavingHome's vacuum-verify path can run ~750s+; the 10-min default killed it every run.
        workflowExecutionTimeout: "20 minutes",
      },
    );
  }
}

export function handleStateChanged(
  client: Client,
  rest: HomeAssistantRestClient,
): (event: EventEnvelope) => Promise<void> {
  return async (event) => {
    const parsed = StateChangedEventData.safeParse(event.data);
    if (!parsed.success) {
      return;
    }
    const { entity_id: entityId } = parsed.data;
    if (PetCareEntityIdSchema.safeParse(entityId).success) {
      await signalPetCareState(
        client,
        petCareUpdateFromState(entityId, parsed.data.new_state),
      );
      return;
    }
    const oldState = parsed.data.old_state?.state;
    const newState = parsed.data.new_state?.state;
    if (ROBOROCK_VACUUM_ENTITY_SET.has(entityId)) {
      if (oldState !== newState && newState === "unavailable") {
        await signalRoborockReconciler(client);
      }
      return;
    }
    if (
      oldState === undefined ||
      newState === undefined ||
      oldState === newState
    ) {
      return;
    }

    const motionLight = MOTION_LIGHT_ROOMS_BY_ENTITY.get(entityId);
    if (motionLight !== undefined) {
      if (oldState === "off" && newState === "on") {
        await startWorkflow(
          client,
          "motionLight",
          `motion-light-${motionLight.lightEntityId}`,
          {
            args: [motionLight.room],
            workflowIdConflictPolicy:
              WorkflowIdConflictPolicy.TERMINATE_EXISTING,
            workflowExecutionTimeout: "24 hours",
          },
        );
      }
      return;
    }

    if (PERSON_ENTITY_SET.has(entityId)) {
      await handlePersonTransition(client, rest, {
        entityId,
        oldState,
        newState,
      });
    }
  };
}
