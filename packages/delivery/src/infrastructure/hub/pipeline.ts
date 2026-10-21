import { githubCommitLink } from "@shepherdjerred/ops-model/tool-links.ts";
import type {
  ExecutionRef,
  PipelineAction,
  PipelineStage,
  ServicePipeline,
  Transition,
} from "#shared/hub/hub-contract.ts";
import { DeploymentStatusSchema } from "#shared/contract.ts";
import type { Environment } from "#shared/contract.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  environment as readEnvironment,
  version,
} from "#infrastructure/delivery-data.ts";
import { buildSourceLabel } from "#shared/artifact-contract.ts";
import { deploymentLinks } from "./links.ts";
import { artifactToolLinks } from "#shared/hub/artifact-links.ts";
import { buildStatus, stageStatus } from "./status.ts";
import { promotionOrder } from "./topology.ts";
import { buildView, serviceSummary } from "./views.ts";

type BuildRow = Prisma.BuildGetPayload<object>;
type DeploymentRow = Prisma.DeploymentGetPayload<{
  include: { stages: true };
}>;
type VersionRow = Prisma.VersionSetGetPayload<object>;

const AUTOMATIC: Transition = {
  mode: "automatic",
  enabled: true,
  sourceEnvironmentId: null,
};
const iso = (value: Date | null) => value?.toISOString() ?? null;

function sourceStage(
  build: BuildRow | null,
  ref: ExecutionRef | null,
): PipelineStage {
  const actions: PipelineAction[] =
    build === null
      ? []
      : [
          {
            key: "commit",
            title: `Commit ${build.sourceRevision.slice(0, 7)}`,
            status: "succeeded",
            detail: buildSourceLabel(build.sourceKind),
            startedAt: null,
            finishedAt: build.createdAt.toISOString(),
            target: { kind: "build", id: build.id },
            links:
              build.sourceKind === "ci"
                ? [githubCommitLink(build.sourceRevision)]
                : [],
          },
        ];
  return {
    key: "source",
    kind: "source",
    title: "Source",
    status: build === null ? "not_started" : "succeeded",
    execution: ref,
    environmentId: null,
    transition: null,
    actions,
  };
}

function buildStage(
  build: BuildRow | null,
  ref: ExecutionRef | null,
): PipelineStage {
  const actions: PipelineAction[] =
    build === null
      ? []
      : [
          {
            key: "qualification",
            title:
              build.pipelineNumber === null
                ? buildSourceLabel(build.sourceKind)
                : `Woodpecker #${String(build.pipelineNumber)}`,
            status: buildStatus(build.status),
            detail: build.qualificationReason,
            startedAt:
              build.status === "pending" ||
              build.qualificationCheckedAt !== null
                ? build.createdAt.toISOString()
                : null,
            finishedAt:
              build.status === "pending"
                ? null
                : (iso(build.qualificationCheckedAt) ??
                  build.createdAt.toISOString()),
            target: { kind: "build", id: build.id },
            links: buildView(build).links,
          },
        ];
  return {
    key: "build",
    kind: "build",
    title: "Build",
    status: build === null ? "not_started" : buildStatus(build.status),
    execution: ref,
    environmentId: null,
    transition: AUTOMATIC,
    actions,
  };
}

async function versionStage(
  database: Database,
  latest: VersionRow | null,
  sourceRevision: string | null,
): Promise<PipelineStage> {
  const base = {
    key: "version",
    kind: "version" as const,
    title: "Version set",
    environmentId: null,
    transition: AUTOMATIC,
  };
  if (latest === null)
    return { ...base, status: "not_started", execution: null, actions: [] };
  const selected = await version(database, latest.id);
  return {
    ...base,
    status: "succeeded",
    execution: {
      buildId: latest.qualifiedBuildId,
      versionSetId: latest.id,
      revision: latest.revision,
      sourceRevision,
    },
    actions: Object.values(selected.components)
      .toSorted((left, right) => left.component.localeCompare(right.component))
      .map((artifact) => ({
        key: artifact.component,
        title: artifact.component,
        status: "succeeded",
        detail: artifact.version,
        startedAt: null,
        finishedAt: artifact.createdAt,
        target: { kind: "versionSet", id: latest.id },
        links: artifactToolLinks(artifact),
      })),
  };
}

export function environmentTransition(
  env: Environment,
  enabled: string[],
): Transition {
  let mode: Transition["mode"] = "manual";
  if (env.approvalRequired) mode = "approval";
  else if (env.automatic) mode = "automatic";
  else if (env.promotionSourceEnvironmentId !== null) mode = "promotion";
  return {
    mode,
    enabled: enabled.includes(env.id),
    sourceEnvironmentId: env.promotionSourceEnvironmentId,
  };
}

export function deploymentActions(
  deployment: DeploymentRow,
  application: string | null,
  revision: number | null,
): PipelineAction[] {
  const label = revision === null ? "" : ` r${String(revision)}`;
  const stages = deployment.stages.toSorted(
    (left, right) =>
      (left.startedAt ?? left.updatedAt).getTime() -
      (right.startedAt ?? right.updatedAt).getTime(),
  );
  return [
    {
      key: "deployment",
      title: `${deployment.kind}${label}`,
      status: DeploymentStatusSchema.parse(deployment.status),
      detail: deployment.message ?? `Requested by ${deployment.requestedBy}`,
      startedAt:
        iso(deployment.startedAt) ?? deployment.createdAt.toISOString(),
      finishedAt: iso(deployment.finishedAt),
      target: { kind: "deployment", id: deployment.id },
      links: deploymentLinks(deployment, application),
    },
    ...stages.map((stage) => ({
      key: `stage:${stage.key}`,
      title: stage.key,
      status: stageStatus(stage.status),
      detail: stage.message === "" ? null : stage.message,
      startedAt: iso(stage.startedAt),
      finishedAt:
        stage.status === "running" ? null : stage.updatedAt.toISOString(),
      target: { kind: "deployment" as const, id: deployment.id },
      links: [],
    })),
  ];
}

async function environmentStage(
  database: Database,
  env: Environment,
  enabled: string[],
): Promise<PipelineStage> {
  const deployment = await database.deployment.findFirst({
    where: { environmentId: env.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { stages: true },
  });
  const selected =
    deployment === null
      ? null
      : await database.versionSet.findUnique({
          where: { id: deployment.versionSetRevisionId },
        });
  const qualifiedBuildId = selected?.qualifiedBuildId ?? null;
  const build =
    qualifiedBuildId === null
      ? null
      : await database.build.findUnique({ where: { id: qualifiedBuildId } });
  return {
    key: `environment:${env.id}`,
    kind: "environment",
    title: env.name,
    status:
      deployment === null
        ? "not_started"
        : DeploymentStatusSchema.parse(deployment.status),
    execution:
      selected === null
        ? null
        : {
            buildId: selected.qualifiedBuildId,
            versionSetId: selected.id,
            revision: selected.revision,
            sourceRevision: build?.sourceRevision ?? null,
          },
    environmentId: env.id,
    transition: environmentTransition(env, enabled),
    actions:
      deployment === null
        ? []
        : deploymentActions(
            deployment,
            env.application,
            selected?.revision ?? null,
          ),
  };
}

/** Source → Build → Version set → environments in promotion order. */
export async function servicePipeline(
  database: Database,
  serviceId: string,
  enabled: string[],
): Promise<ServicePipeline> {
  const service = serviceSummary(serviceId);
  const [build, latestVersion, rows] = await Promise.all([
    database.build.findFirst({
      where: { serviceId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    database.versionSet.findFirst({
      where: { serviceId },
      orderBy: { revision: "desc" },
    }),
    database.environment.findMany({ where: { serviceId } }),
  ]);
  const environments = promotionOrder(
    await Promise.all(rows.map((row) => readEnvironment(database, row.id))),
  );
  const buildVersion =
    build === null
      ? null
      : await database.versionSet.findUnique({
          where: { qualifiedBuildId: build.id },
        });
  const ref: ExecutionRef | null =
    build === null
      ? null
      : {
          buildId: build.id,
          versionSetId: buildVersion?.id ?? null,
          revision: buildVersion?.revision ?? null,
          sourceRevision: build.sourceRevision,
        };
  const versionBuildId = latestVersion?.qualifiedBuildId ?? null;
  const versionBuild =
    versionBuildId === null
      ? null
      : await database.build.findUnique({ where: { id: versionBuildId } });
  return {
    service,
    latestBuild: build === null ? null : buildView(build),
    stages: [
      sourceStage(build, ref),
      buildStage(build, ref),
      await versionStage(
        database,
        latestVersion,
        versionBuild?.sourceRevision ?? null,
      ),
      ...(await Promise.all(
        environments.map((env) => environmentStage(database, env, enabled)),
      )),
    ],
  };
}
