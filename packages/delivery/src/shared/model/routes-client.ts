import { z } from "zod";
import {
  DeploymentSchema,
  RecoverDeploymentSchema,
  StageSchema,
} from "#shared/contract.ts";
import {
  CreateDeploymentSchema,
  CreateDeploymentV2Schema,
} from "#shared/deployment-request-contract.ts";
import { RecoveryIntentV2Schema } from "#shared/recovery-intent.ts";
import { EnvironmentDetailSchema } from "#shared/hub/hub-contract.ts";
import type { createRequester } from "#shared/http-request.ts";
import {
  ApprovalV2InputSchema,
  ApprovalV2Schema,
  type ApprovalV2Request,
} from "./approval-contract.ts";
import { CatalogDocumentSchema } from "./catalog-contract.ts";
import {
  MonitorObservationInputSchema,
  MonitorObservationSchema,
  MonitorStatusSchema,
  WatchingMonitorSchema,
} from "./monitor-contract.ts";
import {
  AttestationRequestSchema,
  ApproveTofuPlanSchema,
  CatalogReconcileResultSchema,
  CatalogStateSchema,
  DeploymentV2Schema,
  EnvironmentSelectionSchema,
  ReconcileAfterRestoreRequestSchema,
  ReconcileAfterRestoreSchema,
  RecoveryIntentRequestSchema,
  RestoreHoldSettledSchema,
  RetireServiceRequestSchema,
  ServiceLifecycleViewSchema,
  type AttestationRequest,
  type ApproveTofuPlan,
  type ReconcileAfterRestoreRequest,
  type RecoveryIntentRequest,
  type RetireServiceRequest,
} from "./route-contract.ts";
import { RollbackCandidatesSchema } from "./selection-contract.ts";
import {
  SettleRestoreHoldSchema,
  type SettleRestoreHold,
} from "./cold-start-contract.ts";

/** Request bodies as callers write them, before schema defaults apply. */
export type CreateDeploymentV2Request = z.input<
  typeof CreateDeploymentV2Schema
>;
export type CreateDeploymentRequest =
  z.input<typeof CreateDeploymentSchema> | CreateDeploymentV2Request;
export type CatalogDocumentRequest = z.input<typeof CatalogDocumentSchema>;
export type MonitorObservationRequest = z.input<
  typeof MonitorObservationInputSchema
>;

const segment = (value: string) => encodeURIComponent(value);
const deploymentPath = (id: string, rest: string) =>
  `/deployments/${segment(id)}/${rest}`;
const environmentPath = (id: string, rest: string) =>
  `/environments/${segment(id)}/${rest}`;

/** Validate a request body against its contract, then send it as written. */
function checked<T>(schema: z.ZodType<unknown, T>, input: T): T {
  schema.parse(input);
  return input;
}

/**
 * The model routes (`docs/model.md`) under `/api/v1`. Every request body is
 * validated against its contract before it is sent, so a malformed request
 * never reaches the network; the server applies the contract's defaults.
 * Every response is validated before use.
 */
export function modelRoutes(request: ReturnType<typeof createRequester>) {
  return {
    /**
     * `deploy`, `promote`, `rollback`, `rebind` and the other model kinds
     * (4.12). Host-only worker adoption keeps its v1 request, as the server
     * reads it.
     */
    createDeployment: (input: CreateDeploymentRequest) => {
      if (input.kind === "adopt-worker") CreateDeploymentSchema.parse(input);
      else CreateDeploymentV2Schema.parse(input);
      return request("/deployments", DeploymentV2Schema, input);
    },
    /** Previously accepted selections and why each excluded one is excluded (D9). */
    rollbackCandidates: (environmentId: string) =>
      request(
        environmentPath(environmentId, "rollback-candidates"),
        RollbackCandidatesSchema,
      ),
    /** The accepted deployment's monitor (4.19). */
    monitor: (environmentId: string) =>
      request(environmentPath(environmentId, "monitor"), MonitorStatusSchema),
    /**
     * One environment with what a release needs, including `releaseKind`:
     * what the server realises a set revision by under the recipe it
     * freezes (E0, L2).
     */
    environmentDetail: (environmentId: string) =>
      request(
        `/environments/${segment(environmentId)}`,
        EnvironmentDetailSchema,
      ),
    /** Accepted selection beside the declared binding (4.9, 4.10). */
    selection: (environmentId: string) =>
      request(
        environmentPath(environmentId, "selection"),
        EnvironmentSelectionSchema,
      ),
    /** Executor: deployments whose monitor is watching. */
    watchingMonitors: () =>
      request("/monitors/watching", z.array(WatchingMonitorSchema)),
    /** Executor: one observation of a watching deployment. */
    observeMonitor: (deploymentId: string, input: MonitorObservationRequest) =>
      request(
        deploymentPath(deploymentId, "monitor/observations"),
        MonitorObservationSchema,
        checked(MonitorObservationInputSchema, input),
      ),
    /** A human decision on the frozen selection, optionally marked `override` (H4). */
    approve: (deploymentId: string, input: ApprovalV2Request) =>
      request(
        deploymentPath(deploymentId, "approval"),
        ApprovalV2Schema,
        checked(ApprovalV2InputSchema, input),
      ),
    /** Admin: inspect one `recovery-required` deployment (4.15). */
    createRecoveryIntent: (
      deploymentId: string,
      input: RecoveryIntentRequest,
    ) =>
      request(
        deploymentPath(deploymentId, "recovery-intents"),
        RecoveryIntentV2Schema,
        checked(RecoveryIntentRequestSchema, input),
      ),
    recoveryIntent: (id: string) =>
      request(`/recovery-intents/${segment(id)}`, RecoveryIntentV2Schema),
    /** Admin: settle a pending `argo` intent by independent readback of the inspected operation. */
    settleRecoveryIntent: (
      id: string,
      input: z.input<typeof RecoverDeploymentSchema>,
    ) =>
      request(
        `/recovery-intents/${segment(id)}/settle`,
        DeploymentSchema,
        checked(RecoverDeploymentSchema, input),
      ),
    /** Operator: attested evidence for one stage of an `operator-run` deployment. */
    attest: (deploymentId: string, input: AttestationRequest) =>
      request(
        deploymentPath(deploymentId, "attestations"),
        StageSchema,
        checked(AttestationRequestSchema, input),
      ),
    /** A human approves the exact unexpired saved plan a `tofu` recipe's approve step waits for. */
    approvePlan: (deploymentId: string, input: ApproveTofuPlan) =>
      request(
        deploymentPath(deploymentId, "plan-approval"),
        StageSchema,
        checked(ApproveTofuPlanSchema, input),
      ),
    /** Admin: register the catalog document's services, environments, revisions and edges. */
    reconcileCatalog: (document: CatalogDocumentRequest) =>
      request(
        "/catalog/reconcile",
        CatalogReconcileResultSchema,
        checked(CatalogDocumentSchema, document),
      ),
    catalog: () => request("/catalog", CatalogStateSchema),
    /** Admin: retire a service (4.2); its environments stop admitting deployments. */
    retireService: (serviceId: string, input: RetireServiceRequest) =>
      request(
        `/services/${segment(serviceId)}/retire`,
        ServiceLifecycleViewSchema,
        checked(RetireServiceRequestSchema, input),
      ),
    /** Admin: accept the live state an environment was held on after a restore. */
    settleRestoreHold: (environmentId: string, input: SettleRestoreHold) =>
      request(
        environmentPath(environmentId, "restore-hold/accept"),
        RestoreHoldSettledSchema,
        checked(SettleRestoreHoldSchema, input),
      ),
    /** Admin: compare record, cold-start snapshot and live target; hold mismatches. */
    reconcileAfterRestore: (input: ReconcileAfterRestoreRequest) =>
      request(
        "/reconcile-after-restore",
        ReconcileAfterRestoreSchema,
        checked(ReconcileAfterRestoreRequestSchema, input),
      ),
  };
}
export type ModelRoutes = ReturnType<typeof modelRoutes>;
