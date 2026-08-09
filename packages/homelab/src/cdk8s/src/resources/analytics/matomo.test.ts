import { describe, expect, it } from "bun:test";
import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createMatomoChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/matomo.ts";

const MatomoDeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({
    name: z.literal("matomo"),
    annotations: z.object({
      "ignore-check.kube-linter.io/run-as-non-root": z.string(),
    }),
  }),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z.object({
            name: z.string(),
            command: z.array(z.string()).optional(),
            args: z.array(z.string()).optional(),
            securityContext: z.object({
              runAsNonRoot: z.boolean(),
              runAsUser: z.number().optional(),
              runAsGroup: z.number().optional(),
              allowPrivilegeEscalation: z.literal(false),
            }),
          }),
        ),
      }),
    }),
  }),
});

const PublicGateConfigSchema = z.object({
  kind: z.literal("ConfigMap"),
  metadata: z.object({ name: z.literal("matomo-matomo-public-gate-config") }),
  data: z.object({ "nginx.conf": z.string() }),
});

describe("Matomo deployment", () => {
  it("uses image-compatible identities without allowing privilege escalation", () => {
    const app = new App();
    createMatomoChart(app);
    const documents = parseAllDocuments(app.synthYaml()).map((document) =>
      document.toJS(),
    );
    const deployment = documents
      .map((document) => MatomoDeploymentSchema.safeParse(document))
      .find((result) => result.success);
    const config = documents
      .map((document) => PublicGateConfigSchema.safeParse(document))
      .find((result) => result.success);
    if (!deployment?.success || !config?.success) {
      throw new Error("Matomo resources were not synthesized");
    }

    const securityContexts = Object.fromEntries(
      deployment.data.spec.template.spec.containers.map((container) => [
        container.name,
        container.securityContext,
      ]),
    );
    expect(securityContexts).toMatchObject({
      matomo: { runAsNonRoot: false, allowPrivilegeEscalation: false },
      "matomo-archive": {
        runAsNonRoot: false,
        allowPrivilegeEscalation: false,
      },
      "matomo-public-gate": {
        runAsNonRoot: true,
        runAsUser: 101,
        runAsGroup: 101,
        allowPrivilegeEscalation: false,
      },
    });
    const archiveContainer = deployment.data.spec.template.spec.containers.find(
      (container) => container.name === "matomo-archive",
    );
    if (archiveContainer?.args === undefined) {
      throw new Error("Matomo archive container command was not synthesized");
    }
    expect(archiveContainer.args.join(" ")).toContain(
      "grep -Fqx '[database]' /var/www/html/config/config.ini.php",
    );
    const nginxConfig = config.data.data["nginx.conf"];
    expect(nginxConfig).toStartWith("pid /tmp/nginx.pid;");
    for (const temporaryPath of [
      "client_body_temp_path /tmp/client-body;",
      "proxy_temp_path /tmp/proxy;",
      "fastcgi_temp_path /tmp/fastcgi;",
      "uwsgi_temp_path /tmp/uwsgi;",
      "scgi_temp_path /tmp/scgi;",
    ]) {
      expect(nginxConfig).toContain(temporaryPath);
    }
  });
});
