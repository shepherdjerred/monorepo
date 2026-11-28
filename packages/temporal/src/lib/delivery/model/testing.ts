import { gzipSync } from "node:zlib";
import { DeploymentDetailSchema } from "@shepherdjerred/delivery/contract";

/** Build a minimal POSIX ustar `.tgz` archive in memory for chart template tests. */
export function buildChartTgz(
  entries: readonly { path: string; content: string }[],
): Uint8Array {
  const blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for (const entry of entries) {
    const payload = encoder.encode(entry.content);
    const header = new Uint8Array(512);
    header.set(encoder.encode(entry.path).subarray(0, 100), 0);
    header.set(encoder.encode("0000644\0"), 100);
    header.set(encoder.encode("0001000\0"), 108);
    header.set(encoder.encode("0001000\0"), 116);
    header.set(
      encoder.encode(`${payload.length.toString(8).padStart(11, "0")}\0`),
      124,
    );
    header.set(encoder.encode("14700000000\0"), 136);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.set(encoder.encode("ustar\0"), 257);
    header.set(encoder.encode("00"), 263);
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.set(
      encoder.encode(`${checksum.toString(8).padStart(6, "0")}\0 `),
      148,
    );
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(payload.length / 512) * 512);
    padded.set(payload, 0);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024));
  return new Uint8Array(gzipSync(Buffer.concat(blocks)));
}

/** Test fixtures for the model executor: a running arcade/prod deployment. */
export const timestamp = "2026-10-21T00:00:00.000Z";
export const digest = (character: string) => `sha256:${character.repeat(64)}`;

export function artifact(input: {
  id: string;
  component: string;
  kind: "image" | "chart" | "archive";
  uri: string;
  version: string;
  character: string;
}) {
  return {
    id: input.id,
    component: input.component,
    kind: input.kind,
    uri: input.uri,
    digest: digest(input.character),
    version: input.version,
    serviceId: "arcade",
    buildId: "build/1",
    sourceRevision: "a".repeat(40),
    createdAt: timestamp,
  };
}

export const image = artifact({
  id: "image/1",
  component: "image:arcade",
  kind: "image",
  uri: "docker.io/shepherdjerred/arcade",
  version: "1.0.1",
  character: "a",
});
/** What arcade/beta accepted, filled into the selection by a tracking reference (A5). */
const accepted = artifact({
  id: "image/accepted",
  component: "image:arcade-accepted",
  kind: "image",
  uri: "docker.io/shepherdjerred/arcade",
  version: "1.0.0",
  character: "e",
});
const runner = artifact({
  id: "ci-base/1",
  component: "image:ci-base",
  kind: "image",
  uri: "docker.io/shepherdjerred/ci-base",
  version: "1",
  character: "f",
});

export function recipe(
  source: Record<string, unknown>,
  chartComponent: string,
) {
  return {
    kind: "kubernetes-application",
    application: {
      name: "arcade",
      project: "default",
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "arcade",
      },
      source,
      lifecycle: "cascade",
    },
    chartComponent,
    artifactParameters: chartComponent.startsWith("chart:")
      ? {
          "image.tag": { component: "image:arcade", format: "tag-digest" },
          "sandbox.image": {
            component: "image:arcade-accepted",
            format: "reference",
          },
        }
      : {},
    runner: { service: "ci", component: "image:ci-base" },
    steps: [
      { kind: "apply-safety", instance: "application:arcade" },
      { kind: "sync", instance: "application:arcade" },
    ],
    oracle: {
      probes: [{ url: "https://arcade.sjer.red/health", expectedStatus: 200 }],
      tests: [
        { suite: "e2e", resultPath: "packages/arcade/test-results/e2e.json" },
      ],
    },
  };
}

export function detail(
  definition: unknown,
  sourceArtifact: ReturnType<typeof artifact>,
  stages: { key: string; status: "running" | "succeeded" | "failed" }[] = [],
) {
  return DeploymentDetailSchema.parse({
    deployment: {
      id: "deployment/1",
      requestId: "request/1",
      environmentId: "arcade/prod",
      serviceId: "arcade",
      versionSetRevisionId: "version/1",
      pipelineRevisionId: "arcade/3",
      configurationId: "config/1",
      catalogRevision: "test-catalog",
      expectedGeneration: 0,
      kind: "deploy",
      status: "running",
      requestedBy: "operator",
      message: null,
      cancelRequested: false,
      recoveryRequired: false,
      createdAt: timestamp,
      startedAt: timestamp,
      finishedAt: null,
      admissionSnapshot: {
        prerequisites: [],
        runners: [
          { service: "ci", component: "image:ci-base", artifact: runner },
        ],
      },
    },
    environment: {
      id: "arcade/prod",
      serviceId: "arcade",
      name: "prod",
      application: "arcade",
      pipelineRevisionId: "arcade/3",
      declaredConfigurationId: "config/1",
      automatic: false,
      promotionSourceEnvironmentId: null,
      role: "durable",
      lifecycle: "active",
      approvalPolicy: "none",
      acceptedDeploymentId: null,
      generation: 1,
      desiredVersionSetRevisionId: null,
      observedVersionSetRevisionId: null,
      acceptedVersionSetRevisionId: null,
      observedAt: null,
      activeDeploymentId: "deployment/1",
      createdAt: timestamp,
    },
    versionSet: {
      id: "version/1",
      serviceId: "arcade",
      revision: 1,
      baseRevisionId: null,
      lineage: "0".repeat(64),
      orderKey: "0000000001.0000000000",
      createdAt: timestamp,
      components: {
        "image:arcade": image,
        "image:arcade-accepted": accepted,
        [sourceArtifact.component]: sourceArtifact,
      },
    },
    pipeline: { id: "arcade/3", createdAt: timestamp, definition },
    configuration: {
      id: "config/1",
      content: {
        replicas: "2",
        "helm.valuesObject": '{"ingress":{"enabled":true}}',
      },
    },
    evidence: [],
    stages: stages.map((stage) => ({
      ...stage,
      id: `stage/${stage.key}`,
      deploymentId: "deployment/1",
      operationId: "op",
      message: "",
      startedAt: timestamp,
      updatedAt: timestamp,
    })),
  });
}
