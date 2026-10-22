import type { Delivery } from "#infrastructure/delivery.ts";
import type {
  Principal,
  PipelineDefinition,
  RegisterEnvironment,
} from "#shared/contract.ts";

export const testOperator: Principal = {
  id: "operator@example.com",
  kind: "human",
  scopes: ["read", "deploy", "approve", "admin"],
};
export const testPublisher: Principal = {
  id: "ci",
  kind: "machine",
  scopes: ["read", "publish"],
};
export const testExecutor: Principal = {
  id: "executor",
  kind: "machine",
  scopes: ["read", "execute"],
};
/** Machine principals the HTTP route tests authenticate as `fixture-<role>`. */
export const fixturePrincipals: Readonly<Record<string, Principal>> = {
  admin: { id: "fixture-admin", kind: "machine", scopes: ["read", "admin"] },
  deployer: {
    id: "fixture-deployer",
    kind: "machine",
    scopes: ["read", "deploy"],
  },
  executor: {
    id: "fixture-executor",
    kind: "machine",
    scopes: ["read", "execute"],
  },
  publisher: {
    id: "fixture-publisher",
    kind: "machine",
    scopes: ["read", "publish"],
  },
  attestor: {
    id: "fixture-attestor",
    kind: "machine",
    scopes: ["read", "attest"],
  },
};

export type TestRegistration = {
  pipeline: PipelineDefinition;
  environment: RegisterEnvironment;
};
export async function seedDelivery(
  delivery: Delivery,
  registration?: TestRegistration,
) {
  const publication = await delivery.publish(
    {
      requestId: "test-build",
      serviceId: "arcade",
      sourceRevision: "a".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/1",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "arcade-image",
          component: registration === undefined ? "server" : "image:arcade",
          kind: "image",
          uri: "docker.io/shepherdjerred/arcade",
          digest: `sha256:${"a".repeat(64)}`,
          version: "1.0.0",
        },
        {
          id: "arcade-chart",
          component: registration === undefined ? "chart" : "chart:arcade",
          kind: "chart",
          uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-1.0.0.tgz",
          digest: `sha256:${"b".repeat(64)}`,
          version: "1.0.0",
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 1 },
  );
  await delivery.qualify(publication.buildId, "verified", testExecutor);
  const [selected] = await delivery.versions("arcade");
  if (selected === undefined)
    throw new Error("Seed version set was not created");
  await delivery.registerPipeline(
    registration?.environment.pipelineRevisionId ?? "arcade/1",
    registration?.pipeline ?? {
      kind: "argocd",
      application: "arcade",
      chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
      chartName: "arcade",
      chartComponent: "chart",
      parameters: {},
      artifactParameters: { "image.ref": "server" },
      namespace: "arcade",
    },
    testOperator,
  );
  const environment = await delivery.registerEnvironment(
    registration?.environment ?? {
      id: "arcade/prod",
      serviceId: "arcade",
      name: "prod",
      application: "arcade",
      pipelineRevisionId: "arcade/1",
      configurationRevision: "config/1",
      configuration: {},
      automatic: true,
    },
    testOperator,
  );
  return { versionSet: selected, environment, publication };
}
