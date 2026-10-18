import { z } from "zod";
import * as errors from "./client-error.ts";
export const DeliveryClientError = errors.DeliveryClientError;
export type DeliveryClientError = InstanceType<
  typeof errors.DeliveryClientError
>;
import {
  ApiErrorSchema,
  ArtifactVersionSchema,
  LatestQualifiedArtifactQuerySchema,
  DeploymentDetailSchema,
  DeploymentSchema,
  EnvironmentSchema,
  ImportedSnapshotSchema,
  OverviewSchema,
  PipelineRevisionSchema,
  PrincipalSchema,
  VersionSetRevisionSchema,
  diffVersionSets,
  WorkerPoolStateSchema,
  WorkerVersionSchema,
  FindQualifiedArtifactSchema,
  ArtifactAcquisitionSchema,
  WorkerRecoveryIntentSchema,
  WorkerRecoveryContextSchema,
  MinecraftRecoveryIntentSchema,
  MinecraftRecoveryDetailSchema,
  TofuPlanReceiptSchema,
  RecordTofuPlanSchema,
  ForumBaselineContextSchema,
  ForumBaselineIntentSchema,
  QualifiedForumBundleQuerySchema,
  PlatformRecoveryIntentSchema,
  PlatformRecoveryContextSchema,
  RecordPlatformRecoveryPlanSchema,
  PlatformRecoveryPlanReceiptSchema,
  OwnershipHandoverContextSchema,
  ContentRecoveryIntentSchema,
  ContentRecoveryContextSchema,
} from "./contract.ts";
import type {
  CreateDeployment,
  PublishBuild,
  ComposeVersionSet,
  PipelineDefinition,
  RegisterEnvironment,
  LatestQualifiedArtifactQuery,
  ImportSnapshotSchema,
  RegisterWorkerVersion,
  RetireWorkerVersion,
  FindQualifiedArtifact,
  AcquireUpstreamArtifact,
  RequestWorkerRecovery,
  RequestMinecraftRecovery,
  CreatePlatformDeployment,
  RecordTofuPlan,
  RequestControlPlaneUpgrade,
  PublishForumBundle,
  RequestForumBaseline,
  CompleteForumBaseline,
  QualifiedForumBundleQuery,
  RequestPlatformRecovery,
  CompletePlatformRecovery,
  PlatformRecoveryNativeReceipt,
  RecordPlatformRecoveryPlan,
  ApprovePlatformRecoveryPlan,
  AdmitPlatformRecoveryApply,
  RequestTrmnlRepair,
  RequestContentRecovery,
  ContentRecoveryNativeReceipt,
  ContentRecoveryOwnership,
  CompleteContentRecovery,
  AdmitContentRecoveryRepair,
  DispatchBarrier,
  ContentBarrierRestoration,
} from "./contract.ts";

export function createDeliveryClient(options: {
  baseUrl: string;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  headers?: ConstructorParameters<typeof Headers>[0];
}) {
  const transport = options.fetch ?? fetch;
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (!headers.has("Authorization") && options.baseUrl.startsWith("http"))
      headers.set("Origin", new URL(options.baseUrl).origin);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await transport(
      `${options.baseUrl.replace(/\/$/, "")}/api/v1${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers,
        credentials: "same-origin",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const raw: unknown = await response.json();
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(raw);
      throw new DeliveryClientError(
        response.status,
        error.success ? error.data.error.code : "HTTP_ERROR",
        error.success
          ? error.data.error.message
          : `Delivery request failed (${String(response.status)})`,
      );
    }
    return schema.parse(raw);
  }
  const version = (id: string) =>
    request(`/versions/${encodeURIComponent(id)}`, VersionSetRevisionSchema);
  return {
    identity: () => request("/identity", PrincipalSchema),
    overview: () => request("/overview", OverviewSchema),
    latestQualifiedArtifact: (input: LatestQualifiedArtifactQuery) =>
      request(
        `/artifacts/latest-qualified?${new URLSearchParams(LatestQualifiedArtifactQuerySchema.parse(input)).toString()}`,
        ArtifactVersionSchema,
      ),
    versions: (serviceId?: string) =>
      request(
        `/versions${serviceId === undefined ? "" : `?serviceId=${encodeURIComponent(serviceId)}`}`,
        z.array(VersionSetRevisionSchema),
      ),
    version,
    deployment: (id: string) =>
      request(`/deployments/${encodeURIComponent(id)}`, DeploymentDetailSchema),
    diff: async (fromId: string | null, toId: string) => {
      const [from, to] = await Promise.all([
        fromId === null ? null : version(fromId),
        version(toId),
      ]);
      return diffVersionSets(from, to);
    },
    createDeployment: (input: CreateDeployment) =>
      request("/deployments", DeploymentSchema, input),
    createPlatformDeployment: (input: CreatePlatformDeployment) =>
      request("/platform/deployments", DeploymentSchema, input),
    requestPlatformRecovery: (id: string, input: RequestPlatformRecovery) =>
      request(
        `/deployments/${encodeURIComponent(id)}/platform-recovery`,
        PlatformRecoveryIntentSchema,
        input,
      ),
    platformRecovery: (id: string) =>
      request(
        `/platform-recovery/${encodeURIComponent(id)}`,
        PlatformRecoveryContextSchema,
      ),
    pendingPlatformRecovery: () =>
      request(
        "/platform-recovery/pending",
        z.object({ intents: z.array(PlatformRecoveryIntentSchema) }),
      ),
    submittedPlatformRecovery: (id: string, workflowId: string) =>
      request(
        `/platform-recovery/${encodeURIComponent(id)}/submitted`,
        PlatformRecoveryIntentSchema,
        { workflowId },
      ),
    completePlatformRecovery: (id: string, input: CompletePlatformRecovery) =>
      request(
        `/platform-recovery/${encodeURIComponent(id)}/complete`,
        PlatformRecoveryIntentSchema,
        input,
      ),
    failPlatformRecovery: (id: string, message: string) =>
      request(
        `/platform-recovery/${encodeURIComponent(id)}/fail`,
        PlatformRecoveryIntentSchema,
        { message },
      ),
    recordPlatformRecoveryNative: (
      id: string,
      input: PlatformRecoveryNativeReceipt,
    ) =>
      request(
        `/platform-recovery/${encodeURIComponent(id)}/native`,
        PlatformRecoveryIntentSchema,
        input,
      ),
    recordPlatformRecoveryPlan: (
      id: string,
      input: RecordPlatformRecoveryPlan,
    ) =>
      request(
        `/platform-recovery/${encodeURIComponent(id)}/plan`,
        PlatformRecoveryPlanReceiptSchema,
        input,
      ),
    platformRecoveryPlan: (id: string) =>
      request(
        `/platform-recovery/${encodeURIComponent(id)}/plan`,
        RecordPlatformRecoveryPlanSchema,
      ),
    approvePlatformRecoveryPlan: (
      id: string,
      input: ApprovePlatformRecoveryPlan,
    ) =>
      request(
        `/platform-recovery/${encodeURIComponent(id)}/approve`,
        PlatformRecoveryIntentSchema,
        input,
      ),
    admitPlatformRecoveryApply: (
      id: string,
      input: AdmitPlatformRecoveryApply,
    ) =>
      request(
        `/platform-recovery/${encodeURIComponent(id)}/admit-apply`,
        PlatformRecoveryIntentSchema,
        input,
      ),
    publishForumBundle: (input: PublishForumBundle) =>
      request("/forum/bundles", ArtifactAcquisitionSchema, input),
    qualifiedForumBundle: (input: QualifiedForumBundleQuery) =>
      request(
        `/forum/bundles/qualified?${new URLSearchParams(QualifiedForumBundleQuerySchema.parse(input)).toString()}`,
        ArtifactVersionSchema,
      ),
    verifyForumDeploymentBaseline: (id: string) =>
      request(
        `/deployments/${encodeURIComponent(id)}/forum-baseline-check`,
        z.object({ verified: z.literal(true) }),
        {},
      ),
    pendingForumBundles: () =>
      request(
        "/forum/bundles/pending",
        z.object({ builds: z.array(z.object({ id: z.string() })) }),
      ),
    qualifyForumBundle: (id: string) =>
      request(
        `/forum/bundles/${encodeURIComponent(id)}/qualify`,
        ArtifactAcquisitionSchema,
        {},
      ),
    requestForumBaseline: (input: RequestForumBaseline) =>
      request("/forum/baselines", ForumBaselineIntentSchema, input),
    forumBaseline: (id: string) =>
      request(
        `/forum/baselines/${encodeURIComponent(id)}`,
        ForumBaselineContextSchema,
      ),
    pendingForumBaselines: () =>
      request(
        "/forum/baselines/pending",
        z.object({ intents: z.array(ForumBaselineIntentSchema) }),
      ),
    submittedForumBaseline: (id: string, workflowId: string) =>
      request(
        `/forum/baselines/${encodeURIComponent(id)}/submitted`,
        ForumBaselineIntentSchema,
        { workflowId },
      ),
    completeForumBaseline: (id: string, input: CompleteForumBaseline) =>
      request(
        `/forum/baselines/${encodeURIComponent(id)}/complete`,
        ForumBaselineIntentSchema,
        input,
      ),
    failForumBaseline: (id: string, message: string) =>
      request(
        `/forum/baselines/${encodeURIComponent(id)}/fail`,
        ForumBaselineIntentSchema,
        { message },
      ),
    requestTrmnlRepair: (id: string, input: RequestTrmnlRepair) =>
      request(
        `/deployments/${encodeURIComponent(id)}/trmnl-repair`,
        DeploymentSchema,
        input,
      ),
    requestControlPlaneUpgrade: (
      id: string,
      input: RequestControlPlaneUpgrade,
    ) =>
      request(
        `/environments/${encodeURIComponent(id)}/control-plane`,
        DeploymentSchema,
        input,
      ),
    recordTofuPlan: (input: RecordTofuPlan) =>
      request("/platform/plans", TofuPlanReceiptSchema, input),
    tofuPlan: (id: string) =>
      request(
        `/platform/plans/${encodeURIComponent(id)}`,
        RecordTofuPlanSchema,
      ),
    approve: (
      id: string,
      input: { decision: "approve" | "reject"; reason: string },
    ) =>
      request(
        `/deployments/${encodeURIComponent(id)}/approval`,
        DeploymentSchema,
        input,
      ),
    cancel: (id: string) =>
      request(
        `/deployments/${encodeURIComponent(id)}/cancel`,
        DeploymentSchema,
        {},
      ),
    recover: (id: string, input: { operationId: string; reason: string }) =>
      request(
        `/deployments/${encodeURIComponent(id)}/release-lock`,
        DeploymentSchema,
        input,
      ),
    retry: (
      id: string,
      input: { requestId: string; expectedGeneration: number },
    ) =>
      request(
        `/deployments/${encodeURIComponent(id)}/retry`,
        DeploymentSchema,
        input,
      ),
    publish: (input: PublishBuild) =>
      request(
        "/builds",
        z.object({ buildId: z.string(), artifacts: z.array(z.string()) }),
        input,
      ),
    findQualifiedArtifact: (input: FindQualifiedArtifact) =>
      request(
        `/artifacts/qualified-exact?${new URLSearchParams(FindQualifiedArtifactSchema.parse(input))}`,
        ArtifactVersionSchema,
      ),
    acquireUpstreamArtifact: (input: AcquireUpstreamArtifact) =>
      request("/artifacts/upstream", ArtifactAcquisitionSchema, input),
    requestWorkerRecovery: (
      deploymentId: string,
      input: RequestWorkerRecovery,
    ) =>
      request(
        `/deployments/${encodeURIComponent(deploymentId)}/worker-recovery`,
        WorkerRecoveryIntentSchema,
        input,
      ),
    workerRecovery: (id: string) =>
      request(
        `/worker-recovery/${encodeURIComponent(id)}`,
        WorkerRecoveryContextSchema,
      ),
    requestMinecraftRecovery: (id: string, input: RequestMinecraftRecovery) =>
      request(
        `/deployments/${encodeURIComponent(id)}/minecraft-recovery`,
        MinecraftRecoveryIntentSchema,
        input,
      ),
    minecraftRecovery: (id: string) =>
      request(
        `/minecraft-recovery/${encodeURIComponent(id)}`,
        MinecraftRecoveryDetailSchema,
      ),
    requestContentRecovery: (id: string, input: RequestContentRecovery) =>
      request(
        `/deployments/${encodeURIComponent(id)}/content-recovery`,
        ContentRecoveryIntentSchema,
        input,
      ),
    contentRecovery: (id: string) =>
      request(
        `/content-recovery/${encodeURIComponent(id)}`,
        ContentRecoveryContextSchema,
      ),
    recordContentRecoveryNative: (
      id: string,
      input: ContentRecoveryNativeReceipt,
    ) =>
      request(
        `/content-recovery/${encodeURIComponent(id)}/native`,
        ContentRecoveryIntentSchema,
        input,
      ),
    admitContentRecoveryRepair: (
      id: string,
      input: AdmitContentRecoveryRepair,
    ) =>
      request(
        `/content-recovery/${encodeURIComponent(id)}/admit-repair`,
        ContentRecoveryIntentSchema,
        input,
      ),
    completeContentRecovery: (id: string, input: CompleteContentRecovery) =>
      request(
        `/content-recovery/${encodeURIComponent(id)}/complete`,
        ContentRecoveryIntentSchema,
        input,
      ),
    failContentRecovery: (id: string, message: string) =>
      request(
        `/content-recovery/${encodeURIComponent(id)}/fail`,
        ContentRecoveryIntentSchema,
        { message },
      ),
    recordContentRecoveryBarrier: (id: string, journal: DispatchBarrier) =>
      request(
        `/content-recovery/${encodeURIComponent(id)}/barrier`,
        ContentRecoveryIntentSchema,
        journal,
      ),
    admitContentRecoveryRestore: (
      id: string,
      input: ContentRecoveryOwnership,
    ) =>
      request(
        `/content-recovery/${encodeURIComponent(id)}/admit-restore`,
        ContentRecoveryIntentSchema,
        input,
      ),
    restoredContentRecovery: (id: string, input: ContentBarrierRestoration) =>
      request(
        `/content-recovery/${encodeURIComponent(id)}/restored`,
        ContentRecoveryIntentSchema,
        input,
      ),
    compose: (input: ComposeVersionSet) =>
      request("/versions", VersionSetRevisionSchema, input),
    registerPipeline: (id: string, definition: PipelineDefinition) =>
      request("/pipelines", PipelineRevisionSchema, { id, definition }),
    registerEnvironment: (input: RegisterEnvironment) =>
      request("/environments", EnvironmentSchema, input),
    workers: (environmentId: string) =>
      request(
        `/environments/${encodeURIComponent(environmentId)}/workers`,
        WorkerPoolStateSchema,
      ),
    registerWorker: (input: RegisterWorkerVersion) =>
      request("/workers", WorkerVersionSchema, input),
    retireWorker: (workerId: string, input: RetireWorkerVersion) =>
      request(
        `/workers/${encodeURIComponent(workerId)}/retire`,
        DeploymentSchema,
        input,
      ),
    imports: () => request("/imports", z.array(ImportedSnapshotSchema)),
    ownershipHandoverContext: () =>
      request("/ownership-handover-context", OwnershipHandoverContextSchema),
    qualifyBuild: (id: string) =>
      request(
        `/builds/${encodeURIComponent(id)}/qualify`,
        z.object({ status: z.enum(["pending", "verified", "failed"]) }),
        {},
      ),
    importSnapshot: (input: z.infer<typeof ImportSnapshotSchema>) =>
      request("/imports", ImportedSnapshotSchema, input),
  };
}
export type DeliveryClient = ReturnType<typeof createDeliveryClient>;
