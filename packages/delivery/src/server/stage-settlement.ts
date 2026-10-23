import type { Delivery } from "#infrastructure/delivery.ts";
import { StageRequestSchema } from "#shared/contract.ts";

/** An already-admitted native operation must retain its checkpoint even during a write pause. */
export async function settlesExistingStage(
  delivery: Delivery,
  request: Request,
) {
  const match = /\/deployments\/([^/]+)\/stages$/u.exec(
    new URL(request.url).pathname,
  );
  if (match?.[1] === undefined) return false;
  const stage = StageRequestSchema.safeParse(await request.clone().json());
  if (!stage.success) return false;
  if (stage.data.status !== "running") return true;
  const existing = await delivery.database.stage.findUnique({
    where: {
      deploymentId_key: {
        deploymentId: decodeURIComponent(match[1]),
        key: stage.data.key,
      },
    },
  });
  return (
    existing?.status === "running" &&
    existing.operationId === stage.data.operationId
  );
}
