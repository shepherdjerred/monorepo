import { describe, expect, test } from "vitest";
import { platformModel, publicHostnames } from "#platform-model";
import { probe } from "./fixtures.ts";
import {
  expectationOf,
  IngressSchema,
  ProbeSchema,
  probesOfNamespace,
  selectNamespaceUrls,
  type Ingress,
  type UrlSelectionInput,
} from "./namespace-urls.ts";

function ingress(namespace: string, host: string, service: string): Ingress {
  return IngressSchema.parse({
    metadata: { name: `${service}-ingress`, namespace },
    spec: {
      ingressClassName: "tailscale",
      tls: [{ hosts: [host] }],
      defaultBackend: { service: { name: service, port: { number: 80 } } },
    },
  });
}

const base: Omit<UrlSelectionInput, "namespace"> = {
  publicHostnames: [
    { hostname: "trmnl.sjer.red", namespace: "trmnl", service: "trmnl" },
    { hostname: "bare.sjer.red", namespace: "bare", service: "bare" },
    { hostname: "site.example.com", namespace: "sites", service: "origin" },
  ],
  tailnetServices: [
    { host: "tracker", namespace: "tracker", exposure: "ingress" },
    { host: "temporal", namespace: "temporal", exposure: "ingress" },
    { host: "bare", namespace: "bare", exposure: "ingress" },
    { host: "grpc", namespace: "bare", exposure: "loadBalancer" },
    { host: "node", namespace: "bare", exposure: "tsnet" },
    { host: "gone", namespace: "bare", exposure: "ingress" },
  ],
  tailnetDomain: "example.ts.net",
  probes: [
    probe("trmnl-internal", "http_2xx", "http://trmnl.trmnl.svc:3000/livez", {
      namespace: "trmnl",
      service: "trmnl",
      path: "internal",
    }),
    probe("trmnl-public", "http_2xx", "https://trmnl.sjer.red/livez", {
      namespace: "trmnl",
      service: "trmnl",
      path: "public",
    }),
    probe(
      "tracker-internal",
      "http_2xx",
      "http://tracker.tracker:7351/readyz",
      {
        namespace: "tracker",
        service: "tracker",
        path: "internal",
      },
    ),
    probe("temporal-internal", "tcp_connect", "frontend.temporal.svc:7233", {
      namespace: "temporal",
      service: "frontend",
      path: "internal",
    }),
    probe("site-root", "http_2xx", "https://site.example.com", {
      site: "site.example.com",
    }),
    probe(
      "site-docs",
      "http_200_no_redirect",
      "https://site.example.com/docs/",
      { site: "site.example.com" },
    ),
  ],
  ingresses: [
    ingress("tracker", "tracker", "tracker"),
    ingress("temporal", "temporal", "frontend"),
    ingress("bare", "bare", "bare"),
    // The same host in another namespace must not be picked up.
    ingress("other", "gone", "other"),
  ],
};

describe("URL selection", () => {
  test("a public hostname is requested where its probe requests it", () => {
    expect(selectNamespaceUrls({ ...base, namespace: "trmnl" })).toEqual({
      checks: [
        {
          kind: "public",
          url: "https://trmnl.sjer.red/livez",
          module: "http_2xx",
          source: "probe",
        },
      ],
      unchecked: [],
    });
  });

  test("a hostname with several probes yields each, with its own module", () => {
    expect(
      selectNamespaceUrls({ ...base, namespace: "sites" }).checks.map(
        (check) => [check.url, check.module],
      ),
    ).toEqual([
      ["https://site.example.com", "http_2xx"],
      ["https://site.example.com/docs/", "http_200_no_redirect"],
    ]);
  });

  test("a tailnet host takes its path from the backend Service's probe", () => {
    expect(
      selectNamespaceUrls({ ...base, namespace: "tracker" }).checks,
    ).toEqual([
      {
        kind: "tailnet",
        url: "https://tracker.example.ts.net/readyz",
        module: "http_2xx",
        source: "probe",
      },
    ]);
  });

  test("a TCP-probed backend is requested at the root with its TCP module", () => {
    expect(
      selectNamespaceUrls({ ...base, namespace: "temporal" }).checks,
    ).toEqual([
      {
        kind: "tailnet",
        url: "https://temporal.example.ts.net/",
        module: "tcp_connect",
        source: "probe",
      },
    ]);
  });

  test("without a probe the root is requested as http_2xx; non-HTTP and missing hosts are unchecked", () => {
    expect(selectNamespaceUrls({ ...base, namespace: "bare" })).toEqual({
      checks: [
        {
          kind: "public",
          url: "https://bare.sjer.red/",
          module: "http_2xx",
          source: "default",
        },
        {
          kind: "tailnet",
          url: "https://bare.example.ts.net/",
          module: "http_2xx",
          source: "default",
        },
      ],
      unchecked: [
        "grpc.example.ts.net: loadBalancer exposure is not HTTP",
        "node.example.ts.net: tsnet exposure is not HTTP",
        "gone.example.ts.net: no live tailscale Ingress serves this host",
      ],
    });
  });

  test("a namespace the model does not expose has nothing to request", () => {
    expect(selectNamespaceUrls({ ...base, namespace: "birmel" })).toEqual({
      checks: [],
      unchecked: [],
    });
  });

  test("the committed platform model resolves for a real namespace", () => {
    const selection = selectNamespaceUrls({
      namespace: "trmnl-dashboard",
      publicHostnames: publicHostnames(),
      tailnetServices: platformModel.tailnetServices,
      tailnetDomain: platformModel.tailnet.domain,
      probes: [],
      ingresses: [],
    });
    expect(selection.checks.map((check) => check.url)).toEqual([
      "https://trmnl.sjer.red/",
    ]);
  });
});

function jobs(namespace: string): string[] {
  return probesOfNamespace(namespace, base.publicHostnames, base.probes).map(
    (entry) => entry.spec.jobName,
  );
}

describe("probes of a namespace", () => {
  test("are those labelled with it and those targeting its public hostnames", () => {
    expect(jobs("trmnl")).toEqual(["trmnl-internal", "trmnl-public"]);
    expect(jobs("sites")).toEqual(["site-root", "site-docs"]);
    expect(jobs("birmel")).toEqual([]);
  });
});

describe("probe expectations", () => {
  test("come from the blackbox module definitions", () => {
    expect(expectationOf("http_2xx")).toEqual({
      statuses: [200, 301, 302],
      followRedirects: true,
      bodyPatterns: [],
    });
    expect(expectationOf("http_200_no_redirect")).toMatchObject({
      statuses: [200],
      followRedirects: false,
    });
    expect(expectationOf("rss_2xx").bodyPatterns).toEqual([
      "<rss",
      "<channel>",
    ]);
    expect(expectationOf("tcp_connect").statuses).toBe("any");
  });

  test("a Probe with a module the repository does not define is refused", () => {
    const valid = probe("job", "http_2xx", "https://example.com/", {});
    expect(ProbeSchema.safeParse(valid).success).toBe(true);
    expect(
      ProbeSchema.safeParse({
        ...valid,
        spec: { ...valid.spec, module: "toString" },
      }).success,
    ).toBe(false);
  });
});
