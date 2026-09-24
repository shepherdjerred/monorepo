import { expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { createPhoenixDeployment } from "./index.ts";

const EnvVarSchema = z
  .object({
    name: z.string(),
    value: z.string().optional(),
    valueFrom: z
      .object({
        secretKeyRef: z.object({ name: z.string(), key: z.string() }),
      })
      .optional(),
  })
  .loose();

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z
            .object({
              name: z.string(),
              env: z.array(EnvVarSchema),
              securityContext: z.record(z.string(), z.unknown()),
            })
            .loose(),
        ),
      }),
    }),
  }),
});

const NetworkPolicySchema = z.object({
  kind: z.literal("NetworkPolicy"),
  spec: z.object({
    ingress: z.array(
      z.object({
        from: z.array(
          z.object({
            namespaceSelector: z.object({
              matchLabels: z.object({
                "kubernetes.io/metadata.name": z.string(),
              }),
            }),
          }),
        ),
      }),
    ),
  }),
});

function synth() {
  const app = new App();
  const chart = new Chart(app, "test", {
    namespace: "phoenix",
    disableResourceNameHashes: true,
  });
  createPhoenixDeployment(chart);
  return Testing.synth(chart);
}

function phoenixContainer() {
  const deployment = synth()
    .map((manifest) => DeploymentSchema.safeParse(manifest))
    .find((result) => result.success)?.data;
  const container = deployment?.spec.template.spec.containers.find(
    (candidate) => candidate.name === "phoenix",
  );
  if (container === undefined) {
    throw new Error("Missing Deployment/phoenix container");
  }
  return container;
}

test("runs with auth, the operator-managed database, and no in-cluster agent tools", () => {
  const container = phoenixContainer();
  const env = new Map(container.env.map((entry) => [entry.name, entry]));

  expect(env.get("PHOENIX_ENABLE_AUTH")?.value).toBe("true");
  for (const key of [
    "PHOENIX_SECRET",
    "PHOENIX_ADMIN_SECRET",
    "PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD",
  ]) {
    expect(env.get(key)?.valueFrom?.secretKeyRef).toEqual({
      name: "phoenix",
      key,
    });
  }

  // $(VAR) expansion only sees earlier entries.
  const names = container.env.map((entry) => entry.name);
  expect(names.indexOf("DB_PASSWORD")).toBeLessThan(
    names.indexOf("PHOENIX_SQL_DATABASE_URL"),
  );
  expect(env.get("PHOENIX_SQL_DATABASE_URL")?.value).toContain(
    "@phoenix-postgresql:5432/phoenix_db",
  );

  expect(env.get("PHOENIX_TELEMETRY_ENABLED")?.value).toBe("false");
  expect(env.get("PHOENIX_DISABLE_AGENT_ASSISTANT")?.value).toBe("true");
  expect(env.get("PHOENIX_AGENTS_DISABLE_BASH")?.value).toBe("true");
  expect(env.get("PHOENIX_ALLOWED_SANDBOX_PROVIDERS")?.value).toBe("WASM");

  expect(container.securityContext).toMatchObject({
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    readOnlyRootFilesystem: true,
    runAsNonRoot: true,
    runAsUser: 65_532,
  });
});

test("admits only the trace gateway, Tailscale, and the health probe", () => {
  const policy = synth()
    .map((manifest) => NetworkPolicySchema.safeParse(manifest))
    .find((result) => result.success)?.data;
  const namespaces = policy?.spec.ingress
    .flatMap((rule) => rule.from)
    .map(
      (peer) =>
        peer.namespaceSelector.matchLabels["kubernetes.io/metadata.name"],
    );
  expect(namespaces?.toSorted()).toEqual([
    "alloy-gateway",
    "prometheus",
    "tailscale",
  ]);
});
