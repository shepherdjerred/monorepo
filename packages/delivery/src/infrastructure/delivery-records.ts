import { createHash } from "node:crypto";
import type { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
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
    action: string;
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
