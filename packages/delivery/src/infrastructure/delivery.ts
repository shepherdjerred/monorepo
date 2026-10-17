import { z } from "zod";
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
import { reconcile } from "./delivery-selection.ts";

/** PostgreSQL delivery operations, grouped by transactional responsibility. */
export class Delivery {
  constructor(readonly database: Database) {}
  importSnapshot = importSnapshot;
  importedSnapshots = importedSnapshots;
  publish = publish;
  compose = compose;
  registerPipeline = registerPipeline;
  registerEnvironment = registerEnvironment;
  createDeployment = createDeployment;
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
  reconcile = reconcile;
}

export const RetrySchema = z
  .object({
    requestId: z.string().min(1),
    expectedGeneration: z.number().int().nonnegative(),
  })
  .strict();
