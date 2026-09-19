import { describe, expect, test } from "vitest";
import { App, Chart, Size } from "cdk8s";
import { PersistentVolumeClaim } from "cdk8s-plus-31";
import { z } from "zod";
import { createBazarrDeployment } from "./bazarr.ts";
import { createPinchtabChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/pinchtab.ts";

const MountSchema = z.object({
  mountPath: z.string(),
  subPath: z.string().optional(),
  readOnly: z.boolean().optional(),
});
const ContainerSchema = z.object({
  name: z.string(),
  env: z.array(
    z.object({
      name: z.string(),
      value: z.string().optional(),
      valueFrom: z
        .object({
          secretKeyRef: z.object({ name: z.string(), key: z.string() }),
        })
        .optional(),
    }),
  ),
  volumeMounts: z.array(MountSchema),
  readinessProbe: z
    .object({ exec: z.object({ command: z.array(z.string()) }) })
    .optional(),
  livenessProbe: z
    .object({ exec: z.object({ command: z.array(z.string()) }) })
    .optional(),
});
const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      metadata: z.object({ annotations: z.record(z.string(), z.string()) }),
      spec: z.object({
        containers: z.array(ContainerSchema),
        initContainers: z.array(z.object({ name: z.string() })),
      }),
    }),
  }),
});
const ConfigSchema = z.object({
  kind: z.literal("ConfigMap"),
  data: z.record(z.string(), z.string()),
});
const BrowserConfigSchema = z.object({
  instanceDefaults: z.object({
    stealthLevel: z.string(),
    humanize: z.boolean(),
  }),
  security: z.object({ allowEvaluate: z.boolean() }),
});
const NetworkSchema = z.object({
  kind: z.literal("NetworkPolicy"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    ingress: z.array(
      z.object({ from: z.array(z.unknown()), ports: z.array(z.unknown()) }),
    ),
  }),
});

function resources(): unknown[] {
  const app = new App();
  const chart = new Chart(app, "media", { namespace: "media" });
  const tv = new PersistentVolumeClaim(chart, "tv", {
    storage: Size.gibibytes(1),
  });
  const movies = new PersistentVolumeClaim(chart, "movies", {
    storage: Size.gibibytes(1),
  });
  createBazarrDeployment(chart, { tv, movies });
  createPinchtabChart(app);
  return app.charts.flatMap((item) => item.toJson());
}

describe("Chinese subtitle integration", () => {
  test("mounts discovered providers without masking the built-in directory", () => {
    const deployments = resources().flatMap((resource) => {
      const parsed = DeploymentSchema.safeParse(resource);
      return parsed.success ? [parsed.data] : [];
    });
    const bazarr = deployments.find((deployment) =>
      deployment.spec.template.spec.initContainers.some(
        (c) => c.name === "configure-subtitle-providers",
      ),
    );
    if (!bazarr) throw new Error("Bazarr Deployment missing");
    const container = bazarr.spec.template.spec.containers[0];
    if (!container) throw new Error("Bazarr container missing");
    const directory = "/app/bazarr/bin/custom_libs/subliminal_patch/providers";
    for (const provider of ["subhd", "zimuku", "chinese_script", "assrt"]) {
      expect(container.volumeMounts).toContainEqual({
        mountPath: `${directory}/${provider}.py`,
        subPath: `${provider}.py`,
        readOnly: true,
      });
    }
    expect(
      container.volumeMounts.some((mount) => mount.mountPath === directory),
    ).toBe(false);
    expect(
      container.env.find((env) => env.name === "SUBHD_PINCHTAB_TOKEN"),
    ).toEqual({
      name: "SUBHD_PINCHTAB_TOKEN",
      valueFrom: {
        secretKeyRef: { name: "bazarr-pinchtab-token", key: "PINCHTAB_TOKEN" },
      },
    });
    expect(
      bazarr.spec.template.metadata.annotations["checksum/subtitle-providers"],
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  test("keeps the browser API ready while liveness recovers a stopped browser", () => {
    const synthesized = resources();
    const config = synthesized.flatMap((resource) => {
      const parsed = ConfigSchema.safeParse(resource);
      return parsed.success && "config.json" in parsed.data.data
        ? [parsed.data]
        : [];
    })[0];
    if (!config) throw new Error("PinchTab config missing");
    expect(config.data["dockerenv"]).toBe("");
    const browser = BrowserConfigSchema.parse(
      JSON.parse(config.data["config.json"] ?? ""),
    );
    expect(browser.instanceDefaults).toEqual({
      stealthLevel: "full",
      humanize: true,
    });
    expect(browser.security.allowEvaluate).toBe(true);
    const deployment = synthesized.flatMap((resource) => {
      const parsed = DeploymentSchema.safeParse(resource);
      return parsed.success &&
        parsed.data.spec.template.spec.initContainers.some(
          (c) => c.name === "install-browser-firewall",
        )
        ? [parsed.data]
        : [];
    })[0];
    if (!deployment) throw new Error("PinchTab Deployment missing");
    const container = deployment.spec.template.spec.containers[0];
    if (!container) throw new Error("PinchTab container missing");
    expect(container.volumeMounts).toContainEqual({
      mountPath: "/.dockerenv",
      subPath: "dockerenv",
      readOnly: true,
    });
    expect(container.livenessProbe?.exec.command.join(" ")).toContain(
      '"status":"running"',
    );
    expect(container.readinessProbe?.exec.command.join(" ")).toContain(
      "/health",
    );
  });

  test("permits only Bazarr pods from media to reach the browser API", () => {
    const policy = resources().flatMap((resource) => {
      const parsed = NetworkSchema.safeParse(resource);
      return parsed.success &&
        parsed.data.metadata.name === "pinchtab-ingress-netpol"
        ? [parsed.data]
        : [];
    })[0];
    if (!policy) throw new Error("PinchTab ingress policy missing");
    expect(policy.spec.ingress[0]?.from).toContainEqual({
      namespaceSelector: {
        matchLabels: { "kubernetes.io/metadata.name": "media" },
      },
      podSelector: { matchLabels: { app: "bazarr" } },
    });
    expect(policy.spec.ingress[0]?.ports).toEqual([
      { port: 9867, protocol: "TCP" },
    ]);
  });
});
