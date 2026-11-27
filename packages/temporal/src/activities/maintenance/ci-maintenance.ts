import { createTemporalClient } from "#client";
import { ciMaintenanceEnabled } from "#config/ci-maintenance.ts";
import {
  CI_MAINTENANCE_ID,
  type MaintenanceObservation,
  type MaintenanceRequest,
} from "#shared/ci-maintenance.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  maintenanceApi,
  maintenanceGithub,
  newestVerifiedMaintenanceSource,
  recentMaintenancePipelines,
  maintenanceAdmissionBusy,
  findMaintenanceReceipt,
  maintenanceCandidates,
  MaintenancePipelineSchema,
} from "./ci-maintenance-client.ts";
import {
  cancelStuckMaintenance,
  type StuckMaintenanceOutcome,
} from "./ci-maintenance-age-out.ts";

export const ciMaintenanceActivities = {
  async wakeCiMaintenance(): Promise<void> {
    if (!(await ciMaintenanceEnabled())) return;
    const client = await createTemporalClient();
    await client.workflow.signalWithStart("runCiMaintenanceCoordinator", {
      workflowId: CI_MAINTENANCE_ID,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [],
      signal: "maintenanceTick",
      signalArgs: [],
    });
  },
  async inspectCiMaintenance(
    pending: MaintenanceRequest | null,
  ): Promise<MaintenanceObservation> {
    const enabled = await ciMaintenanceEnabled();
    if (!enabled && pending === null)
      return {
        enabled,
        candidates: [],
        pending: null,
        busy: false,
        observedAt: new Date().toISOString(),
      };
    const [manual, busy] = await Promise.all([
      pending === null ? [] : recentMaintenancePipelines("manual"),
      maintenanceAdmissionBusy(),
    ]);
    const receipt =
      pending === null ? null : await findMaintenanceReceipt(pending, manual);
    if (!enabled || busy || pending !== null)
      return {
        enabled,
        candidates: [],
        pending: receipt,
        busy,
        observedAt: new Date().toISOString(),
      };
    const source = await newestVerifiedMaintenanceSource();
    if (source === undefined)
      return {
        enabled,
        candidates: [],
        pending: null,
        busy: false,
        observedAt: new Date().toISOString(),
      };
    const github = await maintenanceGithub();
    return {
      enabled,
      candidates: await maintenanceCandidates(github, source),
      pending: null,
      busy: false,
      observedAt: new Date().toISOString(),
    };
  },
  async submitCiMaintenance(
    request: MaintenanceRequest,
  ): Promise<number | null> {
    if (!(await ciMaintenanceEnabled())) return null;
    if ((await newestVerifiedMaintenanceSource()) !== request.source)
      return null;
    // A canary can arrive after candidate inspection. Recheck immediately
    // before the single external write; a deferral leaves no pipeline receipt.
    if (await maintenanceAdmissionBusy()) return null;
    const response = await maintenanceApi("", {
      method: "POST",
      body: JSON.stringify({
        branch: "main",
        message: `ci-maintenance/${request.requestId}`,
        variables: {
          CI_MAINTENANCE_KIND: request.kind,
          CI_MAINTENANCE_SOURCE: request.source,
          CI_MAINTENANCE_FINGERPRINT: request.fingerprint,
        },
      }),
    });
    return MaintenancePipelineSchema.parse(response).number;
  },
  /**
   * Cancels a queued request only with evidence that it is stuck. Once the
   * cancel is sent the outcome is returned, never thrown, and the coordinator
   * records it so the cancel is not sent again.
   */
  async cancelStuckCiMaintenance(
    request: MaintenanceRequest,
  ): Promise<StuckMaintenanceOutcome> {
    return await cancelStuckMaintenance(request);
  },
};
export type CiMaintenanceActivities = typeof ciMaintenanceActivities;
