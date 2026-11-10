import { Testing } from "cdk8s";
import { Deployment, Secret, type EnvValue } from "cdk8s-plus-31";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  bugsinkEnv,
  fliptEnv,
  FLIPT_URL,
  seaweedfsS3,
  telemetryEnv,
} from "./runtime-env.ts";

const EnvEntry = z.object({
  name: z.string(),
  value: z.string().optional(),
  valueFrom: z
    .object({
      secretKeyRef: z.object({ name: z.string(), key: z.string() }),
    })
    .optional(),
});
const Workload = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(z.object({ env: z.array(EnvEntry) })),
      }),
    }),
  }),
});

/**
 * The container's environment as it renders: a list, in declaration order.
 * Asserting on the rendered list rather than the returned object is the point,
 * because the order is what an adopting workload must not change.
 */
function render(
  build: (chart: ReturnType<typeof Testing.chart>) => Record<string, EnvValue>,
) {
  const chart = Testing.chart();
  const envVariables = build(chart);
  new Deployment(chart, "workload", {
    containers: [{ image: "example", envVariables }],
  });
  const workloads = Testing.synth(chart).flatMap((document) => {
    const parsed = Workload.safeParse(document);
    return parsed.success ? [parsed.data] : [];
  });
  return workloads.flatMap((workload) =>
    workload.spec.template.spec.containers.flatMap((container) =>
      container.env.map((entry) =>
        entry.valueFrom === undefined
          ? `${entry.name}=${entry.value ?? ""}`
          : `${entry.name}<-${entry.valueFrom.secretKeyRef.name}/${entry.valueFrom.secretKeyRef.key}`,
      ),
    ),
  );
}

describe("fliptEnv", () => {
  test("declares the mode first, then namespace, environment and URL", () => {
    expect(
      render(() => fliptEnv({ namespace: "tracker", environment: "prod" })),
    ).toEqual([
      "FEATURE_FLAGS_MODE=flipt",
      "FLIPT_NAMESPACE=tracker",
      "FLIPT_ENVIRONMENT=prod",
      `FLIPT_URL=${FLIPT_URL}`,
    ]);
  });

  test("an explicit order reproduces a workload's existing declaration order", () => {
    expect(
      render(() =>
        fliptEnv({
          namespace: "storm",
          environment: "beta",
          order: ["FLIPT_URL", "FLIPT_NAMESPACE", "FLIPT_ENVIRONMENT"],
        }),
      ),
    ).toEqual([
      "FEATURE_FLAGS_MODE=flipt",
      `FLIPT_URL=${FLIPT_URL}`,
      "FLIPT_NAMESPACE=storm",
      "FLIPT_ENVIRONMENT=beta",
    ]);
  });
});

describe("telemetryEnv", () => {
  const endpoint =
    "OTLP_ENDPOINT=http://alloy-gateway.alloy-gateway.svc.cluster.local:4318";

  test("without a service name it is only the switch and the endpoint", () => {
    expect(render(() => telemetryEnv())).toEqual([
      "TELEMETRY_ENABLED=true",
      endpoint,
    ]);
  });

  test("the service name follows the endpoint by default", () => {
    expect(render(() => telemetryEnv({ serviceName: "worker" }))).toEqual([
      "TELEMETRY_ENABLED=true",
      endpoint,
      "TELEMETRY_SERVICE_NAME=worker",
    ]);
  });

  test("serviceNameFirst declares the service name before the endpoint", () => {
    expect(
      render(() =>
        telemetryEnv({ serviceName: "birmel", serviceNameFirst: true }),
      ),
    ).toEqual([
      "TELEMETRY_ENABLED=true",
      "TELEMETRY_SERVICE_NAME=birmel",
      endpoint,
    ]);
  });
});

describe("bugsinkEnv", () => {
  test("by default it is the DSN from the workload's secret", () => {
    expect(
      render((chart) =>
        bugsinkEnv(Secret.fromSecretName(chart, "secret", "app-secrets")),
      ),
    ).toEqual(["BUGSINK_DSN<-app-secrets/BUGSINK_DSN"]);
  });

  test("a report adds the switch, environment and release around the DSN", () => {
    expect(
      render((chart) =>
        bugsinkEnv(Secret.fromSecretName(chart, "secret", "app-secrets"), {
          environment: "production",
          release: "1.2.3",
        }),
      ),
    ).toEqual([
      "BUGSINK_ENABLED=true",
      "BUGSINK_DSN<-app-secrets/BUGSINK_DSN",
      "BUGSINK_ENVIRONMENT=production",
      "BUGSINK_RELEASE=1.2.3",
    ]);
  });
});

describe("seaweedfsS3", () => {
  const Item = z.object({
    kind: z.literal("OnePasswordItem"),
    metadata: z.object({ name: z.string() }),
    spec: z.object({ itemPath: z.string() }),
  });

  function items(name?: string) {
    const chart = Testing.chart();
    seaweedfsS3.item(chart, "s3-credentials", name);
    return Testing.synth(chart).map((document) => Item.parse(document));
  }

  test("the mirrored item points at the shared credentials in the homelab vault", () => {
    const [item] = items("relay-seaweedfs-s3-credentials");
    expect(item?.metadata.name).toBe("relay-seaweedfs-s3-credentials");
    expect(item?.spec.itemPath).toMatch(
      /^vaults\/[a-z0-9]+\/items\/vet52jaeh75chsalu6lulugium$/u,
    );
  });

  test("without a name the item keeps the name cdk8s derives from its id", () => {
    const [item] = items();
    expect(item?.metadata.name).toContain("s3-credentials");
  });

  test("credentials map the item's SEAWEEDFS fields onto the AWS variable names", () => {
    expect(
      render((chart) =>
        seaweedfsS3.credentialsEnv(
          Secret.fromSecretName(chart, "secret", "s3-credentials"),
        ),
      ),
    ).toEqual([
      "AWS_ACCESS_KEY_ID<-s3-credentials/SEAWEEDFS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY<-s3-credentials/SEAWEEDFS_SECRET_ACCESS_KEY",
    ]);
  });
});
