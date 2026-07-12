import { beforeEach, describe, expect, test } from "bun:test";
import {
  getRegisteredBackendProbes,
  getRegisteredPublicProbes,
  registerBackendProbe,
  registerPublicProbe,
  resetProbeRegistry,
} from "./probe-registry.ts";

beforeEach(() => {
  resetProbeRegistry();
});

describe("registerBackendProbe", () => {
  test("registers a single backend probe", () => {
    registerBackendProbe({
      namespace: "home",
      serviceName: "scrypted",
      port: 11_080,
    });

    expect(getRegisteredBackendProbes()).toEqual([
      {
        namespace: "home",
        serviceName: "scrypted",
        port: 11_080,
        module: "http_2xx",
      },
    ]);
  });

  test("dedupes a second registration for the identical {namespace, serviceName, port} — the TailscaleIngress + createCloudflareTunnelBinding overlap case", () => {
    registerBackendProbe({
      namespace: "bugsink",
      serviceName: "bugsink-service",
      port: 8000,
      module: "http_2xx",
    });
    registerBackendProbe({
      namespace: "bugsink",
      serviceName: "bugsink-service",
      port: 8000,
    });

    expect(getRegisteredBackendProbes()).toHaveLength(1);
  });

  test("does not dedupe when the port differs (distinct services can share a namespace/name coincidentally)", () => {
    registerBackendProbe({ namespace: "media", serviceName: "svc", port: 80 });
    registerBackendProbe({
      namespace: "media",
      serviceName: "svc",
      port: 8080,
    });

    expect(getRegisteredBackendProbes()).toHaveLength(2);
  });

  test("does not dedupe when the namespace differs", () => {
    registerBackendProbe({ namespace: "a", serviceName: "svc", port: 80 });
    registerBackendProbe({ namespace: "b", serviceName: "svc", port: 80 });

    expect(getRegisteredBackendProbes()).toHaveLength(2);
  });

  test("defaults module to http_2xx when omitted", () => {
    registerBackendProbe({ namespace: "home", serviceName: "svc", port: 80 });

    expect(getRegisteredBackendProbes()[0]?.module).toBe("http_2xx");
  });

  test("honors an explicit module override", () => {
    registerBackendProbe({
      namespace: "temporal",
      serviceName: "temporal-server",
      port: 7233,
      module: "tcp_connect",
    });

    expect(getRegisteredBackendProbes()[0]?.module).toBe("tcp_connect");
  });
});

describe("registerPublicProbe", () => {
  test("registers a public probe and never dedupes against another public probe", () => {
    registerPublicProbe({
      namespace: "bugsink",
      serviceName: "bugsink-service",
      fqdn: "bugsink.sjer.red",
    });
    registerPublicProbe({
      namespace: "bugsink",
      serviceName: "bugsink-service",
      fqdn: "bugsink.sjer.red",
    });

    expect(getRegisteredPublicProbes()).toHaveLength(2);
  });

  test("a public-probe registration never dedupes against or interferes with a backend-probe registration for the same service", () => {
    registerBackendProbe({
      namespace: "bugsink",
      serviceName: "bugsink-service",
      port: 8000,
    });
    registerPublicProbe({
      namespace: "bugsink",
      serviceName: "bugsink-service",
      fqdn: "bugsink.sjer.red",
    });

    expect(getRegisteredBackendProbes()).toHaveLength(1);
    expect(getRegisteredPublicProbes()).toHaveLength(1);
  });

  test("defaults path to / when omitted", () => {
    registerPublicProbe({
      namespace: "bugsink",
      serviceName: "bugsink-service",
      fqdn: "bugsink.sjer.red",
    });

    expect(getRegisteredPublicProbes()[0]?.path).toBe("/");
  });

  test("honors an explicit path override (e.g. an origin health endpoint)", () => {
    registerPublicProbe({
      namespace: "temporal",
      serviceName: "temporal-worker-gh-webhook",
      fqdn: "pr-bot.sjer.red",
      module: "http_2xx",
      path: "/healthz",
    });

    const probe = getRegisteredPublicProbes()[0];
    expect(probe?.module).toBe("http_2xx");
    expect(probe?.path).toBe("/healthz");
  });
});
