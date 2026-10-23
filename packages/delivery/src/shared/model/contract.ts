import * as admission from "./admission-contract.ts";
import * as render from "./application-render.ts";
import * as stageKeys from "./stage-keys.ts";
import * as routes from "./route-contract.ts";
import * as approvals from "./approval-contract.ts";
import * as coldStart from "./cold-start-contract.ts";
import * as catalog from "./catalog-contract.ts";
import * as deploymentRequests from "#shared/deployment-request-contract.ts";
import * as monitors from "./monitor-contract.ts";
import * as adapter from "./recipe-adapter.ts";
import * as recipes from "./recipe-contract.ts";
import * as bindings from "./recipe-bindings.ts";
import * as recovery from "#shared/recovery-intent.ts";
import * as selections from "./selection-contract.ts";
import * as views from "./recipe-view.ts";
import type { StoredRecipeDefinition } from "./record-contract.ts";

/**
 * Contracts for the Delivery model (`docs/model.md`). They are additive: the
 * running v1 system reads none of them until the cutover. `contract.ts`
 * stays the v1 surface; this entry carries the v2 shapes.
 */

export const CatalogDocumentSchema = catalog.CatalogDocumentSchema;
export const RecipeRevisionSchema = catalog.RecipeRevisionSchema;
export type CatalogDocument = catalog.CatalogDocument;
export type RecipeRevision = catalog.RecipeRevision;
export function canonicalJson(value: unknown): string {
  return catalog.canonicalJson(value);
}
export function catalogRevision(document: CatalogDocument): Promise<string> {
  return catalog.catalogRevision(document);
}
export function serviceLineage(
  componentNames: readonly string[],
): Promise<string> {
  return catalog.serviceLineage(componentNames);
}

export const RecipeDefinitionSchema = recipes.RecipeDefinitionSchema;
export const KubernetesApplicationRecipeSchema =
  recipes.KubernetesApplicationRecipeSchema;
export const StaticSiteRecipeSchema = recipes.StaticSiteRecipeSchema;
export const TofuRecipeSchema = recipes.TofuRecipeSchema;
export const ChannelRecipeSchema = recipes.ChannelRecipeSchema;
export const OperatorRunRecipeSchema = recipes.OperatorRunRecipeSchema;
export const CompoundRecipeSchema = recipes.CompoundRecipeSchema;
export const ApplicationBodySchema = recipes.ApplicationBodySchema;
export const KubernetesStepSchema = recipes.KubernetesStepSchema;
export const TofuStepKindSchema = recipes.TofuStepKindSchema;
export const ChannelStoreSchema = recipes.ChannelStoreSchema;
export const OracleSchema = recipes.OracleSchema;
export const ProbeSchema = recipes.ProbeSchema;
export const RunnerReferenceSchema = recipes.RunnerReferenceSchema;
export const TargetInstanceSchema = recipes.TargetInstanceSchema;
export type RecipeDefinition = recipes.RecipeDefinition;
export type RecipeKind = recipes.RecipeKind;
export type ApplicationBody = recipes.ApplicationBody;
export type KubernetesStep = recipes.KubernetesStep;
export type RunnerReference = recipes.RunnerReference;
export function recipeFromPipeline(
  definition: Parameters<typeof adapter.recipeFromPipeline>[0],
): RecipeDefinition {
  return adapter.recipeFromPipeline(definition);
}
export function recipeComponents(definition: RecipeDefinition): string[] {
  return bindings.recipeComponents(definition);
}
export const PLAN_APPROVAL_STAGE_KEY = stageKeys.PLAN_APPROVAL_STAGE_KEY;
export function stepStageKey(prefix: "step" | "test", name: string): string {
  return stageKeys.stepStageKey(prefix, name);
}
export function subRecipeStageKey(index: number, key: string): string {
  return stageKeys.subRecipeStageKey(index, key);
}
export function attestationStageKey(stage: string): string {
  return stageKeys.attestationStageKey(stage);
}
export type HelmSource = recipes.HelmSource;
export type GitSource = recipes.GitSource;
export type ArtifactParameter = recipes.ArtifactParameter;
export function helmSource(source: HelmSource | GitSource): HelmSource | null {
  return recipes.helmSource(source);
}
export function artifactParameterComponent(value: ArtifactParameter): string {
  return recipes.artifactParameterComponent(value);
}
export const ArtifactParameterFormatSchema =
  recipes.ArtifactParameterFormatSchema;
export type ArtifactParameterFormat = recipes.ArtifactParameterFormat;
export function renderArtifactParameter(
  format: ArtifactParameterFormat,
  artifact: { uri: string; version: string; digest: string },
): string {
  return recipes.renderArtifactParameter(format, artifact);
}

export const DELIVERY_ENVIRONMENT_ANNOTATION =
  render.DELIVERY_ENVIRONMENT_ANNOTATION;
export type RenderArtifact = render.RenderArtifact;
export type RenderedApplication = render.RenderedApplication;
export function renderApplication(
  input: Parameters<typeof render.renderApplication>[0],
): RenderedApplication {
  return render.renderApplication(input);
}

/** Generation-agnostic views of a stored recipe, for executors of either generation. */
export function applicationOf(
  definition: StoredRecipeDefinition,
): ReturnType<typeof views.applicationOf> {
  return views.applicationOf(definition);
}
export function forumReleaseOf(
  definition: StoredRecipeDefinition,
): ReturnType<typeof views.forumReleaseOf> {
  return views.forumReleaseOf(definition);
}
/** The site a stored recipe activates: v1 `scoutSite`, or a model static-site step. */
export function siteReleaseOf(
  definition: StoredRecipeDefinition,
): ReturnType<typeof views.siteReleaseOf> {
  return views.siteReleaseOf(definition);
}

export const AdmissionSnapshotSchema = admission.AdmissionSnapshotSchema;
export type AdmissionSnapshot = admission.AdmissionSnapshot;

export const ColdStartRequirementSchema = coldStart.ColdStartRequirementSchema;
export const ColdStartReceiptSchema = coldStart.ColdStartReceiptSchema;
export type ColdStartReceipt = coldStart.ColdStartReceipt;
export const COLD_START_SNAPSHOT = coldStart.COLD_START_SNAPSHOT;
export function coldStartArchiveKey(
  snapshot: Parameters<typeof coldStart.coldStartArchiveKey>[0],
): string {
  return coldStart.coldStartArchiveKey(snapshot);
}
export const SnapshotArtifactSchema = coldStart.SnapshotArtifactSchema;
export const SnapshotEnvironmentSchema = coldStart.SnapshotEnvironmentSchema;
export const ColdStartSnapshotSchema = coldStart.ColdStartSnapshotSchema;
export type SnapshotArtifact = coldStart.SnapshotArtifact;
export type SnapshotEnvironment = coldStart.SnapshotEnvironment;
export type ColdStartSnapshot = coldStart.ColdStartSnapshot;

export const RecipeKindSchema = routes.RecipeKindSchema;
export const EnvironmentSelectionSchema = routes.EnvironmentSelectionSchema;
export const DeploymentV2Schema = routes.DeploymentV2Schema;
export const DeploymentDetailV2Schema = routes.DeploymentDetailV2Schema;
export const ApprovalQueueItemSchema = routes.ApprovalQueueItemSchema;
export const RecoveryIntentRequestSchema = routes.RecoveryIntentRequestSchema;
export const AttestationRequestSchema = routes.AttestationRequestSchema;
export const ApproveTofuPlanSchema = routes.ApproveTofuPlanSchema;
export type ApproveTofuPlan = routes.ApproveTofuPlan;
export const CatalogReconcileResultSchema = routes.CatalogReconcileResultSchema;
export const CatalogStateSchema = routes.CatalogStateSchema;
export const RetireServiceRequestSchema = routes.RetireServiceRequestSchema;
export const ServiceLifecycleViewSchema = routes.ServiceLifecycleViewSchema;
export const ReconcileAfterRestoreRequestSchema =
  routes.ReconcileAfterRestoreRequestSchema;
export const RestoreComparisonSchema = routes.RestoreComparisonSchema;
export const ReconcileAfterRestoreSchema = routes.ReconcileAfterRestoreSchema;
export type EnvironmentSelection = routes.EnvironmentSelection;
export type DeploymentV2 = routes.DeploymentV2;
export type DeploymentDetailV2 = routes.DeploymentDetailV2;
export type ApprovalQueueItem = routes.ApprovalQueueItem;
export type RecoveryIntentRequest = routes.RecoveryIntentRequest;
export type AttestationRequest = routes.AttestationRequest;
export type CatalogReconcileResult = routes.CatalogReconcileResult;
export type CatalogState = routes.CatalogState;
export type RetireServiceRequest = routes.RetireServiceRequest;
export type ServiceLifecycleView = routes.ServiceLifecycleView;
export type ReconcileAfterRestoreRequest = routes.ReconcileAfterRestoreRequest;
export type ReconcileAfterRestore = routes.ReconcileAfterRestore;

export function recipeRunners(definition: RecipeDefinition): RunnerReference[] {
  return bindings.recipeRunners(definition);
}
export function recipeInstances(definition: RecipeDefinition): string[] {
  return bindings.recipeInstances(definition);
}

export const MonitorSchema = monitors.MonitorSchema;
export const MonitorQuerySchema = monitors.MonitorQuerySchema;
export const MonitorPolicySchema = monitors.MonitorPolicySchema;
export const MonitorStateSchema = monitors.MonitorStateSchema;
export const MonitorOutcomeSchema = monitors.MonitorOutcomeSchema;
export const MonitorObservationInputSchema =
  monitors.MonitorObservationInputSchema;
export const MonitorObservationSchema = monitors.MonitorObservationSchema;
export const WatchingMonitorSchema = monitors.WatchingMonitorSchema;
export const SelfHealingSchema = monitors.SelfHealingSchema;
export const DriftObservationSchema = monitors.DriftObservationSchema;
export type DriftObservation = monitors.DriftObservation;
export const MonitorStatusSchema = monitors.MonitorStatusSchema;
export const FiringAlarmSchema = monitors.FiringAlarmSchema;
export const AlarmSeveritySchema = monitors.AlarmSeveritySchema;
export const MONITOR_PLACEHOLDERS = monitors.MONITOR_PLACEHOLDERS;
export type Monitor = monitors.Monitor;
export type MonitorState = monitors.MonitorState;
export type MonitorObservationInput = monitors.MonitorObservationInput;
export type MonitorObservation = monitors.MonitorObservation;
export type WatchingMonitor = monitors.WatchingMonitor;
export type MonitorStatus = monitors.MonitorStatus;
export type FiringAlarm = monitors.FiringAlarm;
export function unknownMonitorPlaceholders(query: string): string[] {
  return monitors.unknownMonitorPlaceholders(query);
}
export function renderMonitorQuery(
  query: string,
  values: Parameters<typeof monitors.renderMonitorQuery>[1],
): string {
  return monitors.renderMonitorQuery(query, values);
}
export function monitorOutcome(
  monitor: Monitor,
  observation: MonitorObservationInput,
): ReturnType<typeof monitors.monitorOutcome> {
  return monitors.monitorOutcome(monitor, observation);
}

export const SelectionSchema = selections.SelectionSchema;
export const RollbackCandidateSchema = selections.RollbackCandidateSchema;
export const RollbackCandidatesSchema = selections.RollbackCandidatesSchema;
export type Selection = selections.Selection;
export type RollbackCandidate = selections.RollbackCandidate;
export type RollbackCandidates = selections.RollbackCandidates;

export const RecoveryIntentKindSchema = recovery.RecoveryIntentKindSchema;
export const RecoveryIntentV2Schema = recovery.RecoveryIntentV2Schema;
export type RecoveryIntentKind = recovery.RecoveryIntentKind;
export type RecoveryIntentV2 = recovery.RecoveryIntentV2;

export const DeploymentKindV2Schema = deploymentRequests.DeploymentKindV2Schema;
export const CreateDeploymentV2Schema =
  deploymentRequests.CreateDeploymentV2Schema;
export type DeploymentKindV2 = deploymentRequests.DeploymentKindV2;
export type CreateDeploymentV2 = deploymentRequests.CreateDeploymentV2;

export const ApprovalStatusSchema = approvals.ApprovalStatusSchema;
export const ApprovalV2InputSchema = approvals.ApprovalV2InputSchema;
export const ApprovalV2Schema = approvals.ApprovalV2Schema;
export type ApprovalStatus = approvals.ApprovalStatus;
export type ApprovalV2Input = approvals.ApprovalV2Input;
export type ApprovalV2 = approvals.ApprovalV2;

/** The worker pool a stored recipe rolls an image onto (v1 `workerRollout`). */
export function workerRolloutOf(
  definition: StoredRecipeDefinition,
): ReturnType<typeof views.workerRolloutOf> {
  return views.workerRolloutOf(definition);
}
/** The preserved Minecraft world upgrade a stored recipe declares. */
export function minecraftUpgradeOf(
  definition: StoredRecipeDefinition,
): ReturnType<typeof views.minecraftUpgradeOf> {
  return views.minecraftUpgradeOf(definition);
}
/** The model Application recipe that carries a step of `kind`. */
export function stepRecipeOf(
  definition: StoredRecipeDefinition,
  kind: KubernetesStep["kind"],
): ReturnType<typeof views.stepRecipeOf> {
  return views.stepRecipeOf(definition, kind);
}
/** The Application a step acts through; a v1 pipeline has exactly one. */
export function stepApplicationOf(
  definition: StoredRecipeDefinition,
  kind: KubernetesStep["kind"],
): ReturnType<typeof views.stepApplicationOf> {
  return views.stepApplicationOf(definition, kind);
}
/** The Helm values a Helm-source recipe renders, before strvals escaping. */
export function helmValues(
  ...input: Parameters<typeof render.helmValues>
): ReturnType<typeof render.helmValues> {
  return render.helmValues(...input);
}
