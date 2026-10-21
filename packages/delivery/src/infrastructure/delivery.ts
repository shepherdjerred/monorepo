import { z } from "zod";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { index } from "./delivery-data.ts";
import type { Database } from "./database.ts";
import {
  importSnapshot,
  importedSnapshots,
  publish,
  compose,
  registerPipeline,
  registerEnvironment,
} from "./delivery-registration.ts";
import { createDeployment, approve, cancel } from "./delivery-requests.ts";
import { requestTrmnlRepair } from "./trmnl-repair/requests.ts";
import {
  requestContentRecovery,
  contentRecovery,
} from "./content-recovery/requests.ts";
import {
  recordContentRecoveryNative,
  recordContentRecoveryBarrier,
} from "./content-recovery/checkpoints.ts";
import {
  admitContentRecoveryRepair,
  completeContentRecovery,
} from "./content-recovery/settlement.ts";
import {
  admitContentRecoveryRestore,
  restoredContentRecovery,
} from "./content-recovery/restoration.ts";
import { failContentRecovery } from "./content-recovery/failure.ts";
import { claim, stage, finish, releaseLock } from "./delivery-execution.ts";
import { pending, monitor, orphan, submitted } from "./delivery-dispatch.ts";
import {
  detail,
  versions,
  version,
  overview,
  latestQualifiedArtifact,
} from "./delivery-read.ts";
import {
  pendingQualification,
  findBuild,
  markQualificationAttempt,
  qualify,
} from "./delivery-qualification.ts";
import {
  pendingReplication,
  recordReplication,
} from "./artifact-stores/replication.ts";
import { reconcile } from "./delivery-selection.ts";
import { registerWorker, workers } from "./worker-pool/registration.ts";
import { retireWorker } from "./worker-pool/retirement.ts";
import {
  requestWorkerRecovery,
  workerRecovery,
  pendingWorkerRecovery,
  submittedWorkerRecovery,
} from "./worker-pool/recovery.ts";
import {
  completeWorkerRecovery,
  failWorkerRecovery,
} from "./worker-pool/recovery-settlement.ts";
import {
  acquireUpstreamArtifact,
  findQualifiedArtifact,
} from "./upstream-artifact.ts";
import { createPlatformDeployment } from "./platform/requests.ts";
import { recordTofuPlan, tofuPlan } from "./platform/plans.ts";
import { requestControlPlaneUpgrade } from "./control-plane/requests.ts";
import {
  publishForumBundle,
  pendingForumBundles,
  qualifyForumBundle,
  qualifiedForumBundle,
} from "./forum/bundles.ts";
import { verifyForumDeploymentBaseline } from "./forum/preflight.ts";
import {
  createForumPolicyReader,
  type ForumPolicyReader,
} from "./forum/source-policy.ts";
import {
  requestPlatformRecovery,
  platformRecovery,
  pendingPlatformRecovery,
  submittedPlatformRecovery,
} from "./platform-recovery/requests.ts";
import {
  completePlatformRecovery,
  failPlatformRecovery,
  admitPlatformRecoveryApply,
} from "./platform-recovery/settlement.ts";
import {
  recordPlatformRecoveryNative,
  recordPlatformRecoveryPlan,
  platformRecoveryPlan,
  approvePlatformRecoveryPlan,
} from "./platform-recovery/plans.ts";
import {
  requestForumBaseline,
  forumBaseline,
  pendingForumBaselines,
  submittedForumBaseline,
} from "./forum/baseline-requests.ts";
import {
  completeForumBaseline,
  failForumBaseline,
} from "./forum/baseline-settlement.ts";
import {
  requestMinecraftRecovery,
  minecraftRecovery,
  pendingMinecraftRecovery,
  submittedMinecraftRecovery,
  recordMinecraftRecoveryController,
} from "./minecraft-recovery/requests.ts";
import {
  completeMinecraftRecovery,
  failMinecraftRecovery,
} from "./minecraft-recovery/settlement.ts";

/** PostgreSQL delivery operations, grouped by transactional responsibility. */
export class Delivery {
  constructor(
    readonly database: Database,
    readonly repositoryId = 1,
    readonly catalog: ServiceIndex = index,
    readonly forumPolicyReader: ForumPolicyReader = createForumPolicyReader(),
  ) {}
  importSnapshot = importSnapshot;
  importedSnapshots = importedSnapshots;
  publish = publish;
  compose = compose;
  registerPipeline = registerPipeline;
  registerEnvironment = registerEnvironment;
  createDeployment = createDeployment;
  requestTrmnlRepair = requestTrmnlRepair;
  requestContentRecovery = requestContentRecovery;
  contentRecovery = contentRecovery;
  recordContentRecoveryNative = recordContentRecoveryNative;
  recordContentRecoveryBarrier = recordContentRecoveryBarrier;
  admitContentRecoveryRepair = admitContentRecoveryRepair;
  completeContentRecovery = completeContentRecovery;
  failContentRecovery = failContentRecovery;
  admitContentRecoveryRestore = admitContentRecoveryRestore;
  restoredContentRecovery = restoredContentRecovery;
  approve = approve;
  cancel = cancel;
  claim = claim;
  stage = stage;
  finish = finish;
  releaseLock = releaseLock;
  pending = pending;
  monitor = monitor;
  orphan = orphan;
  submitted = submitted;
  detail = detail;
  versions = versions;
  version = version;
  overview = overview;
  latestQualifiedArtifact = latestQualifiedArtifact;
  pendingQualification = pendingQualification;
  build = findBuild;
  markQualificationAttempt = markQualificationAttempt;
  qualify = qualify;
  pendingReplication = pendingReplication;
  recordReplication = recordReplication;
  reconcile = reconcile;
  workers = workers;
  registerWorker = registerWorker;
  retireWorker = retireWorker;
  requestWorkerRecovery = requestWorkerRecovery;
  workerRecovery = workerRecovery;
  pendingWorkerRecovery = pendingWorkerRecovery;
  submittedWorkerRecovery = submittedWorkerRecovery;
  completeWorkerRecovery = completeWorkerRecovery;
  failWorkerRecovery = failWorkerRecovery;
  acquireUpstreamArtifact = acquireUpstreamArtifact;
  findQualifiedArtifact = findQualifiedArtifact;
  createPlatformDeployment = createPlatformDeployment;
  recordTofuPlan = recordTofuPlan;
  tofuPlan = tofuPlan;
  requestControlPlaneUpgrade = requestControlPlaneUpgrade;
  publishForumBundle = publishForumBundle;
  pendingForumBundles = pendingForumBundles;
  qualifyForumBundle = qualifyForumBundle;
  qualifiedForumBundle = qualifiedForumBundle;
  verifyForumDeploymentBaseline = verifyForumDeploymentBaseline;
  requestPlatformRecovery = requestPlatformRecovery;
  platformRecovery = platformRecovery;
  pendingPlatformRecovery = pendingPlatformRecovery;
  submittedPlatformRecovery = submittedPlatformRecovery;
  completePlatformRecovery = completePlatformRecovery;
  failPlatformRecovery = failPlatformRecovery;
  admitPlatformRecoveryApply = admitPlatformRecoveryApply;
  recordPlatformRecoveryNative = recordPlatformRecoveryNative;
  recordPlatformRecoveryPlan = recordPlatformRecoveryPlan;
  platformRecoveryPlan = platformRecoveryPlan;
  approvePlatformRecoveryPlan = approvePlatformRecoveryPlan;
  requestForumBaseline = requestForumBaseline;
  forumBaseline = forumBaseline;
  pendingForumBaselines = pendingForumBaselines;
  submittedForumBaseline = submittedForumBaseline;
  completeForumBaseline = completeForumBaseline;
  failForumBaseline = failForumBaseline;
  requestMinecraftRecovery = requestMinecraftRecovery;
  minecraftRecovery = minecraftRecovery;
  pendingMinecraftRecovery = pendingMinecraftRecovery;
  submittedMinecraftRecovery = submittedMinecraftRecovery;
  recordMinecraftRecoveryController = recordMinecraftRecoveryController;
  completeMinecraftRecovery = completeMinecraftRecovery;
  failMinecraftRecovery = failMinecraftRecovery;
}

export const RetrySchema = z
  .object({
    requestId: z.string().min(1),
    expectedGeneration: z.number().int().nonnegative(),
  })
  .strict();
