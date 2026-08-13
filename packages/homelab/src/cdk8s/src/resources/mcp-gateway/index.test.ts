import { describe, expect, test } from "bun:test";
import { App } from "cdk8s";
import { z } from "zod";
import { createMcpGatewayChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/mcp-gateway.ts";

const ConfigMapSchema = z
  .object({
    kind: z.literal("ConfigMap"),
    metadata: z.object({ name: z.literal("mcp-proxy-config") }).loose(),
    data: z.object({ "config.json": z.string() }),
  })
  .loose();

const DeploymentSchema = z
  .object({
    kind: z.literal("Deployment"),
    metadata: z.object({ name: z.literal("mcp-gateway") }).loose(),
    spec: z.object({
      template: z.object({
        spec: z
          .object({
            initContainers: z.array(
              z
                .object({
                  name: z.string(),
                  args: z.array(z.string()),
                  env: z.array(
                    z
                      .object({
                        name: z.string(),
                        valueFrom: z
                          .object({
                            secretKeyRef: z
                              .object({ name: z.string(), key: z.string() })
                              .loose(),
                          })
                          .loose()
                          .optional(),
                      })
                      .loose(),
                  ),
                })
                .loose(),
            ),
          })
          .loose(),
      }),
    }),
  })
  .loose();

async function synthesize(): Promise<unknown[]> {
  const app = new App();
  await createMcpGatewayChart(app);
  return z.array(z.unknown()).parse(app.charts.at(0)?.toJson());
}

describe("MCP Gateway", () => {
  test("configures Linear and PostHog as authenticated remote upstreams", async () => {
    const manifests = await synthesize();
    const configMap = manifests
      .map((manifest) => ConfigMapSchema.safeParse(manifest))
      .find((result) => result.success)?.data;
    if (configMap === undefined) {
      throw new Error("Missing ConfigMap/mcp-proxy-config");
    }

    const config = z
      .object({
        mcpServers: z.object({
          linear: z.object({
            transportType: z.literal("streamable-http"),
            url: z.literal("https://mcp.linear.app/mcp"),
            headers: z.object({
              Authorization: z.literal("Bearer LINEAR_API_KEY_PLACEHOLDER"),
            }),
          }),
          posthog: z.object({
            transportType: z.literal("streamable-http"),
            url: z.literal("https://mcp.posthog.com/mcp"),
            headers: z.object({
              Authorization: z.literal("Bearer POSTHOG_API_KEY_PLACEHOLDER"),
              "x-posthog-mcp-mode": z.literal("cli"),
            }),
          }),
        }),
      })
      .parse(JSON.parse(configMap.data["config.json"]));

    expect(config.mcpServers.linear.url).toBe("https://mcp.linear.app/mcp");
    expect(config.mcpServers.posthog.headers["x-posthog-mcp-mode"]).toBe("cli");
    expect(configMap.data["config.json"]).not.toMatch(/lin_api_[A-Za-z0-9]+/u);
    expect(configMap.data["config.json"]).not.toMatch(/phx_[A-Za-z0-9]+/u);
  });

  test("renders vendor credentials from the existing Kubernetes Secret", async () => {
    const manifests = await synthesize();
    const deployment = manifests
      .map((manifest) => DeploymentSchema.safeParse(manifest))
      .find((result) => result.success)?.data;
    if (deployment === undefined) {
      throw new Error("Missing Deployment/mcp-gateway");
    }

    const renderer = deployment.spec.template.spec.initContainers.find(
      (container) => container.name === "render-config",
    );
    if (renderer === undefined) {
      throw new Error("Missing render-config init container");
    }

    const secretRefs = new Map(
      renderer.env.flatMap((entry) => {
        const secretKeyRef = entry.valueFrom?.secretKeyRef;
        if (secretKeyRef === undefined) return [];
        return [[entry.name, secretKeyRef]];
      }),
    );

    expect(secretRefs.get("LINEAR_API_KEY")).toEqual({
      name: "mcp-gateway-credentials",
      key: "LINEAR_API_KEY",
    });
    expect(secretRefs.get("POSTHOG_API_KEY")).toEqual({
      name: "mcp-gateway-credentials",
      key: "POSTHOG_API_KEY",
    });
    expect(renderer.args.join("\n")).toContain(
      'if [ -z "${LINEAR_API_KEY:-}" ]',
    );
    expect(renderer.args.join("\n")).toContain(
      'if [ -z "${POSTHOG_API_KEY:-}" ]',
    );
  });
});
