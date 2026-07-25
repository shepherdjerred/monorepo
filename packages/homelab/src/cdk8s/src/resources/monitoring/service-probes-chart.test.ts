import { beforeEach, describe, expect, test } from "bun:test";
import { App } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  registerBackendProbe,
  registerPublicProbe,
  resetProbeRegistry,
} from "@shepherdjerred/homelab/cdk8s/src/misc/probe-registry.ts";
import { createServiceProbesChart } from "./service-probes-chart.ts";

const ProbeSchema = z.object({
  apiVersion: z.literal("monitoring.coreos.com/v1"),
  kind: z.literal("Probe"),
  spec: z.object({
    jobName: z.string(),
    module: z.string(),
    targets: z.object({
      staticConfig: z.object({
        static: z.array(z.string()),
      }),
    }),
  }),
});

beforeEach(() => {
  resetProbeRegistry();
});

function synthProbes() {
  const app = new App();
  createServiceProbesChart(app);
  return app
    .synthYaml()
    .split(/^---$/m)
    .map((document) => document.trim())
    .filter((document) => document.length > 0)
    .map((document) => ProbeSchema.parse(parseYaml(document)));
}

describe("createServiceProbesChart", () => {
  test("backend HTTP probe URL includes the registered path", () => {
    registerBackendProbe({
      namespace: "loki",
      serviceName: "loki",
      port: 3100,
      path: "/ready",
    });

    const [probe] = synthProbes();
    expect(probe?.spec.jobName).toBe("probe-loki-loki-internal");
    expect(probe?.spec.targets.staticConfig.static).toEqual([
      "http://loki.loki.svc.cluster.local:3100/ready",
    ]);
  });

  test("backend HTTP probe URL defaults to /", () => {
    registerBackendProbe({
      namespace: "home",
      serviceName: "scrypted",
      port: 11_080,
    });

    const [probe] = synthProbes();
    expect(probe?.spec.targets.staticConfig.static).toEqual([
      "http://scrypted.home.svc.cluster.local:11080/",
    ]);
  });

  test("backend tcp_connect probe target is host:port with no path even when one is registered", () => {
    registerBackendProbe({
      namespace: "postal",
      serviceName: "postal-web-service",
      port: 5000,
      module: "tcp_connect",
      path: "/ignored",
    });

    const [probe] = synthProbes();
    expect(probe?.spec.module).toBe("tcp_connect");
    expect(probe?.spec.targets.staticConfig.static).toEqual([
      "postal-web-service.postal.svc.cluster.local:5000",
    ]);
  });

  test("public HTTP probe URL includes the registered path", () => {
    registerPublicProbe({
      namespace: "relay",
      serviceName: "relay-service",
      fqdn: "relay.sjer.red",
      path: "/ready",
    });

    const [probe] = synthProbes();
    expect(probe?.spec.jobName).toBe("probe-relay-relay-service-public");
    expect(probe?.spec.targets.staticConfig.static).toEqual([
      "https://relay.sjer.red/ready",
    ]);
  });
});
