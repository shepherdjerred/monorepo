import { expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { createCloudflareTunnelBinding } from "./cloudflare-tunnel.ts";

const TunnelBindingSchema = z.object({
  kind: z.literal("TunnelBinding"),
  metadata: z.object({ name: z.literal("test-test-binding") }),
  subjects: z.tuple([
    z.object({
      kind: z.literal("Service"),
      name: z.literal("test-service"),
      spec: z.object({
        fqdn: z.literal("test.sjer.red"),
        http2Origin: z.literal(false),
        noTlsVerify: z.literal(false),
        proxyAddress: z.literal("127.0.0.1"),
        proxyPort: z.literal(0),
        proxyType: z.literal(""),
      }),
    }),
  ]),
});

test("declares Cloudflare TunnelBinding defaults owned by the operator", () => {
  const app = new App();
  const chart = new Chart(app, "test", {
    namespace: "test",
    disableResourceNameHashes: true,
  });
  createCloudflareTunnelBinding(chart, "test-binding", {
    serviceName: "test-service",
    subdomain: "test",
    port: 8080,
    disableProbe: true,
  });

  const result = Testing.synth(chart)
    .map((manifest) => TunnelBindingSchema.safeParse(manifest))
    .find((candidate) => candidate.success);
  if (!result?.success) {
    throw new Error("TunnelBinding manifest was not synthesized");
  }

  expect(result.data).toEqual({
    kind: "TunnelBinding",
    metadata: { name: "test-test-binding" },
    subjects: [
      {
        kind: "Service",
        name: "test-service",
        spec: {
          fqdn: "test.sjer.red",
          http2Origin: false,
          noTlsVerify: false,
          proxyAddress: "127.0.0.1",
          proxyPort: 0,
          proxyType: "",
        },
      },
    ],
  });
});
