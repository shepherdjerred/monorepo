import {
  DeploymentDetailSchema,
  RegisterEnvironmentSchema,
} from "@shepherdjerred/delivery/contract";

export async function minecraftDetailFixture() {
  const directory = new URL(
    "../../../../delivery/registrations/specialized/minecraft-tsmc/",
    import.meta.url,
  );
  const definition: unknown = await Bun.file(
    new URL("pipeline.json", directory),
  ).json();
  const environment = RegisterEnvironmentSchema.parse(
    await Bun.file(new URL("environment.json", directory)).json(),
  );
  const timestamp = "2026-10-17T20:00:00.000Z";
  const {
    configurationRevision,
    configuration,
    promotionSourceEnvironmentId: _source,
    ...declared
  } = environment;
  const env = DeploymentDetailSchema.shape.environment.parse({
    ...declared,
    application: declared.application ?? null,
    declaredConfigurationId: configurationRevision,
    lifecycle: "active",
    acceptedDeploymentId: null,
    generation: 1,
    promotionSourceEnvironmentId: null,
    desiredVersionSetRevisionId: "set/1",
    observedVersionSetRevisionId: null,
    acceptedVersionSetRevisionId: null,
    observedAt: null,
    activeDeploymentId: "deployment/1",
    createdAt: timestamp,
  });
  return DeploymentDetailSchema.parse({
    deployment: {
      id: "deployment/1",
      requestId: "request/1",
      environmentId: "minecraft/tsmc",
      serviceId: "minecraft",
      versionSetRevisionId: "set/1",
      pipelineRevisionId: "minecraft-tsmc/1",
      configurationId: configurationRevision,
      catalogRevision: "test-catalog",
      expectedGeneration: 0,
      kind: "deploy",
      status: "running",
      requestedBy: "publisher",
      message: null,
      cancelRequested: false,
      recoveryRequired: false,
      createdAt: timestamp,
      startedAt: timestamp,
      finishedAt: null,
    },
    environment: env,
    versionSet: {
      id: "set/1",
      serviceId: "minecraft",
      revision: 1,
      baseRevisionId: null,
      lineage: "0".repeat(64),
      orderKey: "0000000001.0000000000",
      createdAt: timestamp,
      components: {
        "image:the-storm-server": {
          id: "image/1",
          serviceId: "minecraft",
          buildId: "build/1",
          sourceRevision: "a".repeat(40),
          component: "image:the-storm-server",
          kind: "image",
          uri: "docker.io/shepherdjerred/the-storm-server",
          digest: `sha256:${"b".repeat(64)}`,
          version: "build-1",
          createdAt: timestamp,
        },
      },
    },
    pipeline: { id: "minecraft-tsmc/1", createdAt: timestamp, definition },
    configuration: { id: configurationRevision, content: configuration },
    evidence: [],
    stages: [],
  });
}

/** Test-only original snapshot with the real producer's durable journal fields. */
export function minecraftSourceJournalFixture(
  requestId: string,
  candidateImage: string,
) {
  return {
    schemaVersion: 1,
    context: "delivery-tsmc-validation",
    namespace: "minecraft-tsmc",
    requestId,
    candidateImage,
    productionWriteAuthorized: false,
    phase: "PREPARED",
    rollbackImage: candidateImage,
    rollbackTemplate: {
      spec: { containers: [{ name: "minecraft-tsmc", image: candidateImage }] },
    },
    serverUid: "server-original",
    claimUid: "claim-original",
    volumeName: "pv-original",
    volumeUid: "volume-original",
    volumeSource: { driver: "zfs", volumeHandle: "original-dataset" },
    services: Object.fromEntries(
      [
        "minecraft-tsmc",
        "minecraft-tsmc-bedrock",
        "minecraft-tsmc-bluemap",
        "minecraft-tsmc-rcon",
      ].map((name) => [
        name,
        { uid: name, selector: { app: "minecraft-tsmc" } },
      ]),
    ),
    deliveryValidation: {
      sourceApplication: { uid: "argo-original", sourceSha256: "c".repeat(64) },
    },
  };
}
