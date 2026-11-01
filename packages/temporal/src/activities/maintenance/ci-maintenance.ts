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
      return { enabled, candidates: [], pending: null, busy: false };
    const [manual, busy] = await Promise.all([
      pending === null ? [] : recentMaintenancePipelines("manual"),
      maintenanceAdmissionBusy(),
    ]);
    const receipt =
      pending === null ? null : await findMaintenanceReceipt(pending, manual);
    if (!enabled || busy || pending !== null)
      return { enabled, candidates: [], pending: receipt, busy };
    const source = await newestVerifiedMaintenanceSource();
    if (source === undefined)
      return { enabled, candidates: [], pending: null, busy: false };
    const github = await maintenanceGithub();
    return {
      enabled,
      candidates: await maintenanceCandidates(github, source),
      pending: null,
      busy: false,
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
};
export type CiMaintenanceActivities = typeof ciMaintenanceActivities;
