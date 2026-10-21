import { createHash } from "node:crypto";
import type { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import type { AuditAction } from "#shared/hub/change-contract.ts";
import { DeploymentSchema, deliveryWorkflowId } from "#shared/contract.ts";
import type {
  FinishDeployment,
  PipelineDefinition,
  Principal,
  RegisterEnvironment,
} from "#shared/contract.ts";

type Transaction = Prisma.TransactionClient;
export async function replayDeployment(tx: Transaction, resultId: string) {
  return DeploymentSchema.parse(
    wire(
      required(
        await tx.deployment.findUnique({ where: { id: resultId } }),
        "Requested deployment",
      ),
    ),
  );
}
export async function persistDeploymentRequest(
  tx: Transaction,
  actor: Principal,
  options: {
    deployment: { id: string; status: string };
    requestId: string;
    input: unknown;
  },
) {
  const { deployment, ...requestInput } = options;
  if (deployment.status === "queued")
    await tx.outbox.create({
      data: {
        deploymentId: deployment.id,
        workflowId: deliveryWorkflowId(deployment.id),
      },
    });
  await remember(tx, actor, {
    ...requestInput,
    resultType: "deployment",
    resultId: deployment.id,
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => canonical(entry)).join(",")}]`;
  return value !== null && typeof value === "object"
    ? `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
        .join(",")}}`
    : JSON.stringify(value);
}
export function fingerprint(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
/** The one named shared lock (model T1). */
export const PLATFORM_LOCK = "platform";
/** Lock instance of an Argo Application target (model T1). */
export function applicationInstance(application: string) {
  return `application:${application}`;
}
/** Identity of a frozen selection; approvals bind to it (model D6). Matches the migration's SQL. */
export function selectionFingerprint(
  versionSetRevisionId: string,
  pipelineRevisionId: string,
  configurationId: string,
) {
  return createHash("sha256")
    .update(
      [versionSetRevisionId, pipelineRevisionId, configurationId].join("\n"),
    )
    .digest("hex");
}
/** Registered artifact stores (model A6); an artifact outside them is not selectable. */
export const ARTIFACT_STORES = [
  "docker-hub",
  "chartmuseum",
  "delivery-artifacts",
  "storm-forum-releases",
  "upstream-chart-repository",
  "upstream-image-registry",
] as const;
export type ArtifactStore = (typeof ARTIFACT_STORES)[number];
const STORE_PREFIXES: [string, ArtifactStore][] = [
  ["docker.io/", "docker-hub"],
  ["https://chartmuseum.tailnet-1a49.ts.net/", "chartmuseum"],
  ["https://chartmuseum.sjer.red/", "chartmuseum"],
  ["s3://delivery-artifacts/", "delivery-artifacts"],
  ["s3://storm-forum-releases/", "storm-forum-releases"],
];
/**
 * The registered store holding an artifact's bytes (A6). Self-hosted and
 * first-party stores are named by URI prefix, exactly as the v2 migration
 * backfills them; an acquired artifact outside those stores stays in its
 * upstream chart repository or image registry (X11).
 */
export function artifactStore(artifact: {
  uri: string;
  kind: string;
  origin?: { kind: string } | undefined;
}): ArtifactStore {
  const match = STORE_PREFIXES.find(([prefix]) =>
    artifact.uri.startsWith(prefix),
  );
  if (match !== undefined) return match[1];
  if (artifact.origin?.kind === "upstream" && artifact.kind === "chart")
    return "upstream-chart-repository";
  if (artifact.origin?.kind === "upstream" && artifact.kind === "image")
    return "upstream-image-registry";
  throw new DeliveryError(
    "INVALID",
    `Artifact URI ${artifact.uri} belongs to no registered artifact store`,
  );
}
export function wire(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry: unknown) => wire(entry));
  return value !== null && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, wire(entry)]),
      )
    : value;
}
export async function lock(tx: Transaction, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
}
export function required<T>(value: T | null, label: string): T {
  if (value === null)
    throw new DeliveryError("NOT_FOUND", `${label} not found`);
  return value;
}
export async function audit(
  tx: Transaction,
  actor: Principal,
  event: {
    action: AuditAction;
    entityId: string;
    requestId: string;
    metadata?: Prisma.InputJsonObject;
  },
) {
  await tx.audit.create({
    data: {
      id: crypto.randomUUID(),
      actor: actor.id,
      action: event.action,
      entityId: event.entityId,
      requestId: event.requestId,
      metadata: event.metadata ?? {},
    },
  });
}
export async function request(
  tx: Transaction,
  actor: Principal,
  options: { requestId: string; input: unknown; resultType: string },
) {
  const { requestId, input, resultType } = options;
  await lock(tx, `request:${requestId}`);
  const previous = await tx.request.findUnique({ where: { id: requestId } });
  if (
    previous !== null &&
    (previous.fingerprint !== fingerprint(input) ||
      previous.resultType !== resultType ||
      previous.actor !== actor.id)
  )
    throw new DeliveryError(
      "CONFLICT",
      "Request ID was already used with different inputs or identity",
    );
  return previous;
}
export async function remember(
  tx: Transaction,
  actor: Principal,
  options: {
    requestId: string;
    input: unknown;
    resultType: string;
    resultId: string;
  },
) {
  const { requestId, input, resultType, resultId } = options;
  await tx.request.create({
    data: {
      id: requestId,
      actor: actor.id,
      fingerprint: fingerprint(input),
      resultType,
      resultId,
    },
  });
}
export function validateFinish(
  input: FinishDeployment,
  target: string,
  hostOnly = false,
) {
  if (hostOnly && input.observedRevisionId !== undefined)
    throw new DeliveryError(
      "INVALID",
      "Host-only and platform operations cannot report application observation",
    );
  if (
    input.status === "succeeded" &&
    ((hostOnly
      ? input.observedRevisionId !== undefined
      : input.observedRevisionId !== target) ||
      !input.evidence.some((entry) => entry.kind === "acceptance") ||
      !input.evidence.some((entry) => entry.kind === "reconciliation"))
  )
    throw new DeliveryError(
      "INVALID",
      "Success requires exact observed revision, reconciliation and acceptance evidence",
    );
  if (
    input.observedRevisionId !== undefined &&
    input.observedRevisionId !== target
  )
    throw new DeliveryError(
      "INVALID",
      "Observed revision differs from this deployment's target",
    );
  if (input.status === "succeeded" && input.recoveryRequired)
    throw new DeliveryError(
      "INVALID",
      "An ambiguous deployment cannot succeed",
    );
}
export function validateStaticTarget(
  input: RegisterEnvironment,
  pipeline: PipelineDefinition,
) {
  if (pipeline.kind !== "static-site") return;
  if (input.application !== undefined)
    throw new DeliveryError(
      "INVALID",
      "Static site releases use their bucket target; omit the Argo application",
    );
  if (input.serviceId === "scout-for-lol")
    throw new DeliveryError(
      "INVALID",
      "Scout frontend activation belongs to its combined backend environment release and approval",
    );
}
