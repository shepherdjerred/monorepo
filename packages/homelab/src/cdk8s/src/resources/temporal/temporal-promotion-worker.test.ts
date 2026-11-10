import { App, Chart } from "cdk8s";
import { Secret, ServiceAccount } from "cdk8s-plus-31";
import { parseAllDocuments } from "yaml";
import { z } from "zod/v4";
import { describe, expect, it } from "vitest";
import { createTemporalPromotionWorker } from "./workers/promotion-worker.ts";
import { createTemporalAgentWorker } from "./workers/agent-worker.ts";
import promotionPolicy from "homelab/src/talos/seccomp/promotion-policy.json" with { type: "json" };

const SeccompProfileSchema = z.object({
  type: z.enum(["RuntimeDefault", "Localhost"]),
  localhostProfile: z.string().optional(),
});
const SecurityContextSchema = z.object({
  runAsUser: z.number(),
  runAsGroup: z.number(),
  runAsNonRoot: z.boolean(),
  privileged: z.boolean(),
  allowPrivilegeEscalation: z.boolean(),
  readOnlyRootFilesystem: z.boolean(),
  capabilities: z.object({
    add: z.array(z.string()),
    drop: z.array(z.string()),
  }),
  seccompProfile: SeccompProfileSchema.optional(),
});

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    template: z.object({
      spec: z.object({
        automountServiceAccountToken: z.boolean(),
        serviceAccountName: z.string(),
        securityContext: z
          .object({
            fsGroup: z.number().optional(),
            seccompProfile: SeccompProfileSchema.optional(),
          })
          .optional(),
        volumes: z.array(z.looseObject({ name: z.string() })),
        containers: z.array(
          z.object({
            env: z.array(
              z.object({ name: z.string(), value: z.string().optional() }),
            ),
            name: z.string(),
            securityContext: SecurityContextSchema,
            volumeMounts: z.array(
              z.object({
                name: z.string(),
                mountPath: z.string(),
                readOnly: z.boolean().optional(),
              }),
            ),
          }),
        ),
        initContainers: z.array(
          z.object({
            name: z.string(),
            args: z.array(z.string()),
            securityContext: SecurityContextSchema,
          }),
        ),
      }),
    }),
  }),
});

describe("promotion worker sandbox isolation", () => {
  it("opts only the promotion main container into the installed profile and preserves both workers' isolation", () => {
    const app = new App();
    const chart = new Chart(app, "temporal", {
      namespace: "temporal",
      disableResourceNameHashes: true,
    });
    createTemporalPromotionWorker(chart, {
      serverServiceName: "temporal-server",
      temporalSecret: Secret.fromSecretName(
        chart,
        "test-secret",
        "temporal-worker",
      ),
    });
    createTemporalAgentWorker(chart, {
      serviceAccount: new ServiceAccount(
        chart,
        "normal-agent-test-service-account",
        {
          metadata: { name: "temporal-agent-worker" },
        },
      ),
      envVariables: {},
    });
    const deployments = parseAllDocuments(app.synthYaml()).flatMap(
      (document) => {
        const parsed = DeploymentSchema.safeParse(document.toJSON());
        return parsed.success ? [parsed.data] : [];
      },
    );
    expect(deployments).toHaveLength(2);
    for (const role of ["promotion", "agent"] as const) {
      const deployment = deployments.find(
        (candidate) =>
          candidate.metadata.name === `temporal-temporal-${role}-worker`,
      );
      if (deployment === undefined)
        throw new Error(`Missing ${role} deployment`);
      const pod = deployment.spec.template.spec;
      expect(pod.containers).toHaveLength(1);
      expect(pod.initContainers).toHaveLength(1);
      const main = pod.containers[0];
      const firewall = pod.initContainers[0];
      if (main === undefined || firewall === undefined)
        throw new Error(`Missing ${role} containers`);
      expect(main.name).toBe(`temporal-${role}-worker`);
      expect(main.securityContext.seccompProfile).toEqual(
        role === "promotion"
          ? {
              type: "Localhost",
              localhostProfile: `profiles/${promotionPolicy.profileName}`,
            }
          : undefined,
      );
      expect(pod.securityContext?.seccompProfile).toBeUndefined();
      expect(pod.securityContext?.fsGroup).toBeUndefined();
      expect(firewall.securityContext.seccompProfile).toBeUndefined();
      expect(main.securityContext).toMatchObject({
        runAsUser: 0,
        runAsGroup: 1000,
        runAsNonRoot: false,
        privileged: false,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false,
        capabilities: {
          add: ["CHOWN", "DAC_OVERRIDE", "KILL", "SETGID", "SETUID"],
          drop: ["ALL"],
        },
      });
      expect(
        main.securityContext.capabilities.add.map(
          (capability) => `CAP_${capability}`,
        ),
      ).toEqual(promotionPolicy.capabilities);
      expect(firewall).toMatchObject({
        name: "install-provider-firewall",
        securityContext: {
          runAsUser: 0,
          runAsGroup: 0,
          runAsNonRoot: false,
          privileged: false,
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          capabilities: { add: ["NET_ADMIN"], drop: ["ALL"] },
        },
      });
      const rules = firewall.args.join("\n");
      for (const rule of [
        "--uid-owner 1001",
        "for firewall in iptables ip6tables",
        "for port in 7233 8080",
        "temporal.tailnet-1a49.ts.net",
        "temporal-ui.tailnet-1a49.ts.net",
        "*:*) firewall=ip6tables",
        '-d "$address" --dport 443',
        "--reject-with tcp-reset",
      ])
        expect(rules).toContain(rule);
      expect(pod.serviceAccountName).toBe(`temporal-${role}-worker`);
      expect(pod.automountServiceAccountToken).toBe(false);
      expect(
        pod.volumes.filter(
          (volume) => volume.name === "provider-hidden-service-account",
        ),
      ).toEqual([
        {
          name: "provider-hidden-service-account",
          projected: {
            defaultMode: 384,
            sources: [
              {
                serviceAccountToken: { path: "token", expirationSeconds: 3600 },
              },
              {
                configMap: {
                  name: "kube-root-ca.crt",
                  items: [{ key: "ca.crt", path: "ca.crt" }],
                },
              },
              {
                downwardAPI: {
                  items: [
                    {
                      path: "namespace",
                      fieldRef: {
                        apiVersion: "v1",
                        fieldPath: "metadata.namespace",
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ]);
      expect(
        main.volumeMounts.filter(
          (mount) => mount.name === "provider-hidden-service-account",
        ),
      ).toEqual([
        {
          name: "provider-hidden-service-account",
          mountPath: "/var/run/secrets/kubernetes.io/serviceaccount",
          readOnly: true,
        },
      ]);
    }
  });
});

describe("promotion worker authority", () => {
  it("keeps publication credentials in the parent role and retains provider isolation", () => {
    const app = new App();
    const chart = new Chart(app, "temporal", { namespace: "temporal" });
    createTemporalPromotionWorker(chart, {
      serverServiceName: "temporal-server",
      temporalSecret: Secret.fromSecretName(
        chart,
        "test-secret",
        "temporal-worker",
      ),
    });
    const deployment = parseAllDocuments(app.synthYaml())
      .map((document) => DeploymentSchema.safeParse(document.toJSON()))
      .find((parsed) => parsed.success);
    if (deployment?.success !== true)
      throw new Error("Promotion Deployment missing");
    const pod = deployment.data.spec.template.spec;
    const container = pod.containers[0];
    if (container === undefined) throw new Error("Promotion container missing");
    const names = container.env.map((variable) => variable.name);
    expect(names).toContain("ANTI_CAPTCHA_API_KEY");
    expect(names).toContain("PINCHTAB_TOKEN");
    expect(names).toContain("STORM_PROMOTION_LOGINS");
    expect(names).toContain("OPS_INGEST_TOKEN");
    expect(container.env).toContainEqual({
      name: "PROMOTION_DISCORD_SOCKET",
      value: "/tmp/storm-promotion-discord/daemon.sock",
    });
    expect(names).not.toContain("POSTAL_API_KEY");
    expect(names).not.toContain("GH_TOKEN");
    expect(names).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(container.env).toContainEqual({
      name: "TEMPORAL_WORKER_ROLE",
      value: "promotion",
    });
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(container.securityContext).toMatchObject({
      runAsUser: 0,
      allowPrivilegeEscalation: false,
    });
    expect(pod.initContainers[0]?.args.join(" ")).toContain("--uid-owner 1001");
    const service = parseAllDocuments(app.synthYaml())
      .map((document) => document.toJSON() as unknown)
      .find(
        (value) =>
          z
            .object({
              kind: z.literal("Service"),
              metadata: z.object({ name: z.literal("promotion-status") }),
            })
            .safeParse(value).success,
      );
    expect(service).toMatchObject({
      spec: {
        selector: { component: "promotion-worker" },
        ports: [{ port: 7343 }],
      },
    });
  });
});
