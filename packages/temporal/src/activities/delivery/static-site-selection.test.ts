import { expect, test } from "vitest";
import {
  ArtifactVersionSchema,
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
} from "@shepherdjerred/delivery/contract";
import { staticSiteSelection } from "./static-site-selection.ts";
import { STATIC_SITE_DESTINATIONS } from "@shepherdjerred/ops-model/static-release-targets.ts";

function archiveArtifact(component: string, bucket: string, serviceId: string) {
  return ArtifactVersionSchema.parse({
    id: `${component}/candidate`,
    serviceId,
    buildId: "build/candidate",
    sourceRevision: "a".repeat(40),
    component,
    kind: "archive",
    uri: `s3://delivery-artifacts/sites/${bucket}/${"b".repeat(64)}.tar`,
    digest: `sha256:${"b".repeat(64)}`,
    version: "candidate",
    createdAt: "2026-10-17T20:00:00.000Z",
  });
}

test("the actual default writer declaration admits all fifteen registered catalog targets", async () => {
  expect(Object.keys(STATIC_SITE_DESTINATIONS)).toHaveLength(15);
  for (const [bucket, environmentId] of Object.entries(
    STATIC_SITE_DESTINATIONS,
  )) {
    const directory =
      bucket === "scout-frontend"
        ? "specialized/scout-prod"
        : bucket === "scout-frontend-beta"
          ? "specialized/scout-beta"
          : `static/${bucket}`;
    const registration = new URL(
      `../../../../delivery/registrations/${directory}/`,
      import.meta.url,
    );
    const definition = PipelineDefinitionSchema.parse(
      await Bun.file(new URL("pipeline.json", registration)).json(),
    );
    const environment = RegisterEnvironmentSchema.parse(
      await Bun.file(new URL("environment.json", registration)).json(),
    );
    expect(environment.id).toBe(environmentId);
    const policy =
      definition.kind === "static-site"
        ? definition
        : definition.kind === "argocd"
          ? definition.scoutSite
          : undefined;
    if (!policy) throw new Error("Registered static consumer missing");
    expect(policy.bucket).toBe(bucket);
    const result = staticSiteSelection({
      pipeline: { definition },
      environment,
      deployment: { id: "catalog-release", kind: "deploy" },
      versionSet: {
        id: "catalog-set",
        components: {
          [policy.archiveComponent]: archiveArtifact(
            policy.archiveComponent,
            bucket,
            environment.serviceId,
          ),
        },
      },
    });
    expect(result.receipt).toMatchObject({
      bucket,
      deploymentId: "catalog-release",
      versionSetRevisionId: "catalog-set",
    });
  }
});

async function fixture(stage: "beta" | "prod") {
  const definition = PipelineDefinitionSchema.parse(
    await Bun.file(
      new URL(
        `../../../../delivery/registrations/specialized/scout-${stage}/pipeline.json`,
        import.meta.url,
      ),
    ).json(),
  );
  const component =
    stage === "beta" ? "site:scout-frontend-beta" : "site:scout-frontend";
  const bucket = component.slice("site:".length);
  const archive = archiveArtifact(component, bucket, "scout-for-lol");
  return {
    owners: { [bucket]: `scout-for-lol/${stage}` },
    detail: {
      pipeline: { definition },
      environment: { id: `scout-for-lol/${stage}` },
      deployment: { id: "backend-release", kind: "deploy" as const },
      versionSet: {
        id: "shared-candidate",
        components: { [component]: archive },
      },
    },
  };
}

test("both Scout flavors keep the backend deployment, version set and exact archive identity", async () => {
  for (const stage of ["beta", "prod"] as const) {
    const { detail } = await fixture(stage);
    const result = staticSiteSelection(detail);
    expect(result.receipt).toMatchObject({
      deploymentId: "backend-release",
      versionSetRevisionId: "shared-candidate",
      bucket: stage === "beta" ? "scout-frontend-beta" : "scout-frontend",
      archiveDigest: `sha256:${"b".repeat(64)}`,
    });
    expect(result.archive.id).toBe(
      `${result.pipeline.archiveComponent}/candidate`,
    );
  }
});

test("inactive or differently owned Scout targets cannot activate even a qualified archive", async () => {
  const { detail } = await fixture("prod");
  expect(() => staticSiteSelection(detail, {})).toThrow("not delegated");
  expect(() =>
    staticSiteSelection(detail, { "scout-frontend": "scout-for-lol/beta" }),
  ).toThrow("not delegated");
});

test("worker-only lifecycle operations and missing flavor artifacts cannot touch the frontend", async () => {
  const { detail, owners } = await fixture("prod");
  expect(() =>
    staticSiteSelection(
      { ...detail, deployment: { ...detail.deployment, kind: "adopt-worker" } },
      owners,
    ),
  ).toThrow("Worker lifecycle");
  expect(() =>
    staticSiteSelection(
      {
        ...detail,
        deployment: { ...detail.deployment, kind: "retire-worker" },
      },
      owners,
    ),
  ).toThrow("Worker lifecycle");
  expect(() =>
    staticSiteSelection(
      { ...detail, versionSet: { ...detail.versionSet, components: {} } },
      owners,
    ),
  ).toThrow("archive is missing");
});
