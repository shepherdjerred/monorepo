import { describe, expect, it } from "bun:test";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import { createStashChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/stash.ts";
import { STASH_AUTH_INIT_SCRIPT } from "@shepherdjerred/homelab/cdk8s/src/resources/stash/index.ts";
import { createStashApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/stash.ts";
import { applyApplicationReleasePolicy } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";

const ManifestSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
  })
  .loose();

const VALID_HASH = `$2a$10$${"a".repeat(53)}`;
const EXPECTED_STASH_ENV = {
  TZ: "America/Los_Angeles",
  STASH_CONFIG_FILE: "/state/config.yml",
  STASH_STASH: "/data/",
  STASH_METADATA: "/state/metadata/",
  STASH_BLOBS: "/state/blobs/",
  STASH_GENERATED: "/generated/",
  STASH_CACHE: "/cache/",
  STASH_PORT: "9999",
  STASH_HW_DRI_DEVICE: "/dev/dri/renderD128",
};

// Runs the real init script so the credential guards are proven, not just matched
// as text. Every case here fails before the script reaches /state, so no test
// touches the filesystem.
async function runAuthInitScript(
  env: Record<string, string>,
): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(["sh", "-c", STASH_AUTH_INIT_SCRIPT], {
    env: { PATH: Bun.env["PATH"] ?? "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stderr };
}

function synthesize(): unknown[] {
  const app = new App();
  createStashChart(app);
  return z.array(z.unknown()).parse(app.charts.at(0)?.toJson());
}

function findManifest(
  manifests: unknown[],
  kind: string,
  name: string,
): unknown {
  const manifest = manifests.find((candidate) => {
    const parsed = ManifestSchema.safeParse(candidate);
    return (
      parsed.success &&
      parsed.data.kind === kind &&
      parsed.data.metadata.name === name
    );
  });
  if (manifest === undefined)
    throw new Error(`Missing ${kind}/${name} manifest`);
  return manifest;
}

const EnvSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
  valueFrom: z
    .object({
      secretKeyRef: z.object({ name: z.string(), key: z.string() }).loose(),
    })
    .loose()
    .optional(),
});

const ContainerSchema = z
  .object({
    name: z.string(),
    image: z.string(),
    command: z.array(z.string()).optional(),
    args: z.array(z.string()).optional(),
    env: z.array(EnvSchema),
    startupProbe: z.unknown().optional(),
    readinessProbe: z.unknown().optional(),
    livenessProbe: z.unknown().optional(),
    resources: z.unknown(),
    securityContext: z
      .object({
        allowPrivilegeEscalation: z.literal(false),
        privileged: z.literal(false),
        readOnlyRootFilesystem: z.literal(true),
        capabilities: z.object({ drop: z.tuple([z.literal("ALL")]) }),
        seccompProfile: z.object({ type: z.literal("RuntimeDefault") }),
      })
      .loose(),
    volumeMounts: z.array(
      z.object({ mountPath: z.string(), name: z.string() }).loose(),
    ),
  })
  .loose();

describe("Stash chart", () => {
  it("emits the isolated service and three backup-enabled PVCs", () => {
    const manifests = synthesize();
    const names = new Set(
      manifests.map((manifest) => {
        const parsed = ManifestSchema.parse(manifest);
        return `${parsed.kind}/${parsed.metadata.name}`;
      }),
    );

    expect(names).toEqual(
      new Set([
        "Namespace/stash",
        "OnePasswordItem/stash-stash-credentials",
        "PersistentVolumeClaim/stash-state",
        "PersistentVolumeClaim/stash-generated",
        "PersistentVolumeClaim/stash-media",
        "Deployment/stash",
        "Service/stash-stash-service",
        "Ingress/stash-stash-ingress-ingress",
        "NetworkPolicy/stash-network-policy",
      ]),
    );

    const expectedClaims = new Map<string, [string, string]>([
      ["stash-state", ["64Gi", "zfs-ssd"]],
      ["stash-generated", ["256Gi", "zfs-hdd"]],
      ["stash-media", ["1024Gi", "zfs-hdd"]],
    ]);
    for (const [name, [storage, storageClassName]] of expectedClaims) {
      const pvc = z
        .object({
          metadata: z.object({
            labels: z
              .object({
                "velero.io/backup": z.literal("enabled"),
                "velero.io/exclude-from-backup": z.literal("false"),
              })
              .loose(),
          }),
          spec: z.object({
            storageClassName: z.string(),
            resources: z.object({
              requests: z.object({ storage: z.string() }),
            }),
          }),
        })
        .parse(findManifest(manifests, "PersistentVolumeClaim", name));
      expect(pvc.spec.resources.requests.storage).toBe(storage);
      expect(pvc.spec.storageClassName).toBe(storageClassName);
    }
  });

  it("configures built-in authentication before starting the app", () => {
    const deployment = z
      .object({
        spec: z.object({
          strategy: z.object({ type: z.literal("Recreate") }),
          template: z.object({
            spec: z.object({
              automountServiceAccountToken: z.literal(false),
              initContainers: z.array(ContainerSchema),
              containers: z.array(ContainerSchema),
            }),
          }),
        }),
      })
      .parse(findManifest(synthesize(), "Deployment", "stash"));

    const initContainer = deployment.spec.template.spec.initContainers.at(0);
    if (initContainer === undefined)
      throw new Error("Missing authentication init container");
    expect(initContainer.name).toBe("configure-auth");
    expect(initContainer.args).toEqual([STASH_AUTH_INIT_SCRIPT]);
    expect(STASH_AUTH_INIT_SCRIPT).toContain(
      "grep -Eq '^[$]2[aby][$]10[$][./A-Za-z0-9]{53}$'",
    );
    expect(STASH_AUTH_INIT_SCRIPT).toContain("awk '!/^(username|password):/'");
    expect(STASH_AUTH_INIT_SCRIPT).toContain(
      "mv /state/config.yml.next /state/config.yml",
    );
    expect(
      initContainer.env.map(({ name, valueFrom }) => ({
        name,
        secretKey: valueFrom?.secretKeyRef.key,
      })),
    ).toEqual([
      { name: "TZ", secretKey: undefined },
      { name: "STASH_USERNAME", secretKey: "username" },
      { name: "STASH_PASSWORD_HASH", secretKey: "password_hash" },
    ]);
    expect(
      initContainer.volumeMounts.map(({ mountPath }) => mountPath),
    ).toEqual(["/state"]);

    const appContainer = deployment.spec.template.spec.containers.at(0);
    if (appContainer === undefined) throw new Error("Missing app container");
    expect(appContainer.image).toBe(
      "stashapp/stash:v0.31.1@sha256:df744af5a0c976e2ec671052ecc1f8a9aa757fa12b8f9930b59910b7295f0da6",
    );
    expect(appContainer.command).toEqual(["stash"]);
    expect(appContainer.args).toEqual(["--nobrowser"]);
    expect(
      appContainer.env.every(({ valueFrom }) => valueFrom === undefined),
    ).toBe(true);
    expect(appContainer.volumeMounts.map(({ mountPath }) => mountPath)).toEqual(
      ["/state", "/generated", "/data", "/cache", "/tmp"],
    );
    expect(
      Object.fromEntries(
        appContainer.env.map(({ name, value }) => [name, value]),
      ),
    ).toEqual(EXPECTED_STASH_ENV);
    const ProbeSchema = z.object({
      failureThreshold: z.number(),
      periodSeconds: z.number(),
      httpGet: z.object({ path: z.literal("/healthz"), port: z.literal(9999) }),
    });
    expect(ProbeSchema.parse(appContainer.startupProbe)).toEqual({
      failureThreshold: 60,
      periodSeconds: 5,
      httpGet: { path: "/healthz", port: 9999 },
    });
    expect(ProbeSchema.parse(appContainer.readinessProbe)).toEqual({
      failureThreshold: 3,
      periodSeconds: 10,
      httpGet: { path: "/healthz", port: 9999 },
    });
    expect(ProbeSchema.parse(appContainer.livenessProbe)).toEqual({
      failureThreshold: 3,
      periodSeconds: 30,
      httpGet: { path: "/healthz", port: 9999 },
    });
    // cdk8s drops the JSON-patched extended-resource value during synthesis, so
    // the manifest carries a bare `gpu.intel.com/i915: null` placeholder that
    // scripts/patch.ts rewrites to 1 and scripts/test-gpu-resources.ts asserts.
    // Losing the key here would leave that patch step nothing to rewrite.
    const resources = z
      .object({
        limits: z
          .object({ cpu: z.literal("4"), memory: z.literal("4096Mi") })
          .loose(),
        requests: z.object({
          cpu: z.literal("250m"),
          memory: z.literal("512Mi"),
        }),
      })
      .parse(appContainer.resources);
    expect(new Set(Object.keys(resources.limits))).toEqual(
      new Set(["cpu", "memory", "gpu.intel.com/i915"]),
    );
  });

  it.each([
    ["username holding a newline", "admin\nevil_key: injected", VALID_HASH],
    [
      "username smuggling a closing quote",
      'admin\n": 1\nevil_key: "x',
      VALID_HASH,
    ],
    ["username holding a carriage return", "admin\radmin2", VALID_HASH],
    ["username holding a tab", "ad\tmin", VALID_HASH],
    ["hash holding a newline", "admin", `${VALID_HASH}\nevil_key: injected`],
  ])(
    "refuses to write config.yml when the %s",
    async (_case, username, passwordHash) => {
      const { exitCode, stderr } = await runAuthInitScript({
        STASH_USERNAME: username,
        STASH_PASSWORD_HASH: passwordHash,
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("must not contain control characters");
    },
  );

  it("keeps ingress on Tailscale and restricts traffic to required paths", () => {
    const manifests = synthesize();
    const ingress = z
      .object({
        metadata: z.object({
          labels: z.object({
            "tailscale.com/proxy-class": z.literal("medium"),
          }),
        }),
        spec: z.object({
          ingressClassName: z.literal("tailscale"),
          tls: z.array(
            z.object({ hosts: z.array(z.literal("stash")) }).loose(),
          ),
        }),
      })
      .parse(findManifest(manifests, "Ingress", "stash-stash-ingress-ingress"));
    expect(ingress.spec.tls).toHaveLength(1);

    const policy = z
      .object({
        spec: z.object({
          podSelector: z.object({
            matchLabels: z.object({ app: z.literal("stash") }),
          }),
          policyTypes: z.tuple([z.literal("Ingress"), z.literal("Egress")]),
          ingress: z.array(z.unknown()),
          egress: z.array(z.unknown()),
        }),
      })
      .parse(findManifest(manifests, "NetworkPolicy", "stash-network-policy"));
    expect(policy.spec.ingress).toHaveLength(1);
    expect(policy.spec.egress).toHaveLength(2);
  });
});

describe("Stash ArgoCD application", () => {
  it("defines durable ownership with prune-safe lifecycle metadata", () => {
    const app = new App();
    const chart = new Chart(app, "apps", {
      namespace: "argocd",
      disableResourceNameHashes: true,
    });
    createStashApp(chart);
    applyApplicationReleasePolicy(app);

    const application = z
      .object({
        metadata: z.object({
          name: z.literal("stash"),
          annotations: z.object({
            "ci.sjer.red/application-lifecycle": z.literal("cascade"),
          }),
          finalizers: z.tuple([
            z.literal("resources-finalizer.argocd.argoproj.io"),
          ]),
        }),
        spec: z.object({
          destination: z.object({
            namespace: z.literal("stash"),
            server: z.literal("https://kubernetes.default.svc"),
          }),
          source: z.object({
            chart: z.literal("stash"),
            repoURL: z.literal("https://chartmuseum.tailnet-1a49.ts.net"),
            targetRevision: z.literal("~2.0.0-0"),
          }),
          syncPolicy: z.object({
            syncOptions: z.tuple([z.literal("CreateNamespace=true")]),
          }),
        }),
      })
      .parse(findManifest(chart.toJson(), "Application", "stash"));
    expect(application.metadata.name).toBe("stash");
  });
});
