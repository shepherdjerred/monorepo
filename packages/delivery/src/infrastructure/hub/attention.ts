import { z } from "zod";
import type { Attention } from "#shared/hub/hub-contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { servicePlacement } from "./views.ts";

type DeploymentRow = Prisma.DeploymentGetPayload<object>;
const IdRowsSchema = z.array(z.object({ id: z.string() }));

/** What an attention item reads from a deployment. */
export type AttentionDeployment = Pick<
  DeploymentRow,
  | "id"
  | "environmentId"
  | "serviceId"
  | "kind"
  | "requestedBy"
  | "message"
  | "status"
  | "recoveryRequired"
  | "createdAt"
  | "finishedAt"
>;

/** A service whose newest build failed qualification. */
export type FailedBuild = {
  id: string;
  serviceId: string;
  serviceTitle: string;
  reason: string | null;
  at: string;
};

/** The newest deployment of every environment, by environment id. */
export async function latestDeployments(database: Database) {
  const rows = IdRowsSchema.parse(
    await database.$queryRaw`
    SELECT DISTINCT ON ("environmentId") "id" FROM "Deployment"
    ORDER BY "environmentId", "createdAt" DESC, "id" DESC
  `,
  );
  const deployments = await database.deployment.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  return new Map(deployments.map((row) => [row.environmentId, row]));
}

/** The newest build of every service, by service id. */
export async function latestBuilds(database: Database) {
  const rows = IdRowsSchema.parse(
    await database.$queryRaw`
    SELECT DISTINCT ON ("serviceId") "id" FROM "Build"
    ORDER BY "serviceId", "createdAt" DESC, "id" DESC
  `,
  );
  const builds = await database.build.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  return new Map(builds.map((row) => [row.serviceId, row]));
}

/**
 * Names a deployment's subject as people say it, "Scout for LoL prod": the
 * service by its catalog title and the environment by its name. A service
 * this server's catalog does not declare is named by its id.
 */
export function deploymentSubjects(
  environments: readonly { id: string; name: string }[],
) {
  const names = new Map(environments.map((env) => [env.id, env.name]));
  return (deployment: { serviceId: string; environmentId: string }) => {
    const name = names.get(deployment.environmentId);
    if (name === undefined)
      throw new Error(
        `Deployment names unknown environment ${deployment.environmentId}`,
      );
    const service =
      servicePlacement(deployment.serviceId)?.title ?? deployment.serviceId;
    return `${service} ${name}`;
  };
}

/**
 * What someone has to act on, newest first: deployments awaiting approval,
 * environments whose newest deployment failed or requires recovery, and
 * services whose newest build failed qualification.
 */
export function attentionItems(input: {
  awaiting: readonly AttentionDeployment[];
  /** The newest deployment of each environment under watch. */
  latest: Iterable<AttentionDeployment>;
  failedBuilds: readonly FailedBuild[];
  subject: (deployment: AttentionDeployment) => string;
}): Attention[] {
  const { subject } = input;
  const items: Attention[] = input.awaiting.map((deployment) => ({
    kind: "approval",
    title: `${subject(deployment)} awaits approval`,
    detail: `${deployment.kind} requested by ${deployment.requestedBy}`,
    at: deployment.createdAt.toISOString(),
    target: { kind: "deployment", id: deployment.id },
    serviceId: deployment.serviceId,
  }));
  for (const deployment of input.latest) {
    if (deployment.recoveryRequired)
      items.push({
        kind: "recovery",
        title: `${subject(deployment)} requires recovery`,
        detail: deployment.message ?? "The target lock is quarantined",
        at: deployment.finishedAt?.toISOString() ?? null,
        target: { kind: "deployment", id: deployment.id },
        serviceId: deployment.serviceId,
      });
    else if (deployment.status === "failed")
      items.push({
        kind: "failed",
        title: `${subject(deployment)} deployment failed`,
        detail: deployment.message ?? deployment.kind,
        at: deployment.finishedAt?.toISOString() ?? null,
        target: { kind: "deployment", id: deployment.id },
        serviceId: deployment.serviceId,
      });
  }
  for (const build of input.failedBuilds)
    items.push({
      kind: "build_failed",
      title: `${build.serviceTitle} build failed qualification`,
      detail: build.reason ?? "CI did not pass",
      at: build.at,
      target: { kind: "build", id: build.id },
      serviceId: build.serviceId,
    });
  return items.toSorted((left, right) =>
    (right.at ?? "").localeCompare(left.at ?? ""),
  );
}
