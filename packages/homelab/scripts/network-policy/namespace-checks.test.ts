import { describe, expect, test } from "vitest";
import { probe } from "./fixtures.ts";
import {
  denialsFor,
  evaluateDenials,
  evaluatePods,
  evaluateProbes,
  evaluateServices,
  evaluateStage,
  evaluateUrlResponse,
  evaluateUrls,
  namespaceReport,
  parseProbeSuccess,
  PodSchema,
  type CheckResult,
  type Pod,
} from "./namespace-checks.ts";
import type { UrlCheck } from "./namespace-urls.ts";
import { renderReport, renderTable } from "./report.ts";

const NOW = new Date("2026-11-13T12:00:00Z");

function pod(
  name: string,
  overrides: { ready?: boolean; phase?: string; restartedAt?: string } = {},
): Pod {
  return PodSchema.parse({
    metadata: { name },
    status: {
      phase: overrides.phase ?? "Running",
      conditions: [
        { type: "Ready", status: overrides.ready === false ? "False" : "True" },
      ],
      containerStatuses: [
        {
          name: "app",
          restartCount: overrides.restartedAt === undefined ? 0 : 3,
          ...(overrides.restartedAt === undefined
            ? {}
            : {
                lastState: {
                  terminated: { finishedAt: overrides.restartedAt },
                },
              }),
        },
      ],
    },
  });
}

describe("pods", () => {
  test("pass when every pod is Ready and none restarted in the window", () => {
    const result = evaluatePods(
      [pod("a"), pod("b", { restartedAt: "2026-11-13T11:00:00Z" })],
      NOW,
      10,
    );
    expect(result.status).toBe("pass");
    expect(result.summary).toBe(
      "2/2 pods Ready with no restart in the last 10m",
    );
  });

  test("fail on an unready pod and on a restart inside the window", () => {
    const result = evaluatePods(
      [
        pod("a"),
        pod("unready", { ready: false }),
        pod("flapping", { restartedAt: "2026-11-13T11:55:00Z" }),
      ],
      NOW,
      10,
    );
    expect(result.status).toBe("fail");
    expect(result.details).toEqual([
      "unready: not Ready (Running)",
      "flapping: app restarted in the last 10m",
    ]);
  });

  test("the window is configurable and finished Job pods are ignored", () => {
    const pods = [
      pod("flapping", { restartedAt: "2026-11-13T11:55:00Z" }),
      pod("job", { ready: false, phase: "Succeeded" }),
    ];
    expect(evaluatePods(pods, NOW, 2).status).toBe("pass");
    expect(evaluatePods(pods, NOW, 2).summary).toContain("1/1");
  });
});

const slice = (service: string, ready: (boolean | undefined)[]) => ({
  metadata: { labels: { "kubernetes.io/service-name": service } },
  endpoints: ready.map((value) => ({
    conditions: value === undefined ? {} : { ready: value },
  })),
});

const service = (name: string, selector?: Record<string, string>) => ({
  metadata: { name },
  spec: selector === undefined ? {} : { selector },
});

describe("services", () => {
  test("a Service with endpoints and none ready fails", () => {
    const result = evaluateServices(
      [service("web", { app: "web" }), service("down", { app: "down" })],
      [slice("web", [false, undefined]), slice("down", [false])],
    );
    expect(result.status).toBe("fail");
    expect(result.details).toEqual(["down: no ready endpoints"]);
  });

  test("a Service that selects no pods is noted, and selectorless ones are skipped", () => {
    const result = evaluateServices(
      [
        service("web", { app: "web" }),
        service("postgresql-repl", { role: "replica" }),
        service("external"),
        { metadata: { name: "alias" }, spec: { type: "ExternalName" } },
      ],
      [slice("web", [true]), slice("postgresql-repl", [])],
    );
    expect(result.status).toBe("pass");
    expect(result.summary).toBe(
      "1/1 Services backed by pods have ready endpoints",
    );
    expect(result.details).toEqual([
      "postgresql-repl: selects no pods (not counted)",
    ]);
  });
});

const check = (module: UrlCheck["module"]): UrlCheck => ({
  kind: "public",
  url: "https://example.com/healthz",
  module,
  source: "probe",
});

describe("URL answers", () => {
  test("a status the module accepts passes; another fails", () => {
    expect(
      evaluateUrlResponse(check("http_2xx"), { status: 200, body: "" }).status,
    ).toBe("pass");
    expect(
      evaluateUrlResponse(check("http_2xx"), { status: 502, body: "" }),
    ).toEqual({
      status: "fail",
      detail:
        "public https://example.com/healthz: HTTP 502, expected HTTP 200|301|302 (http_2xx)",
    });
    expect(
      evaluateUrlResponse(check("http_2xx"), { status: 401, body: "" }).status,
    ).toBe("fail");
  });

  test("a redirect passes only for a module that follows redirects", () => {
    expect(
      evaluateUrlResponse(check("http_2xx"), { status: 307, body: "" }).status,
    ).toBe("pass");
    expect(
      evaluateUrlResponse(check("http_200_no_redirect"), {
        status: 302,
        body: "",
      }).status,
    ).toBe("fail");
  });

  test("a TCP module accepts any HTTP answer, such as an auth challenge", () => {
    expect(
      evaluateUrlResponse(check("tcp_connect"), { status: 401, body: "" })
        .status,
    ).toBe("pass");
  });

  test("the body must match the module's patterns", () => {
    expect(
      evaluateUrlResponse(check("rss_2xx"), {
        status: 200,
        body: "<rss><channel></channel></rss>",
      }).status,
    ).toBe("pass");
    expect(
      evaluateUrlResponse(check("rss_2xx"), { status: 200, body: "<html>" })
        .detail,
    ).toContain("body does not match <rss, <channel>");
  });

  test("a request that never answers fails", () => {
    expect(
      evaluateUrlResponse(check("http_2xx"), { error: "timed out" }),
    ).toEqual({
      status: "fail",
      detail: "public https://example.com/healthz: timed out",
    });
  });

  test("unchecked hosts make the group not-checked, never a pass", () => {
    expect(evaluateUrls([], []).status).toBe("info");
    expect(
      evaluateUrls([{ status: "pass", detail: "a" }], ["grpc: not HTTP"]),
    ).toMatchObject({
      status: "not-checked",
      summary: "1/2 URLs answer as expected",
    });
    expect(
      evaluateUrls([{ status: "fail", detail: "a" }], ["grpc: not HTTP"])
        .status,
    ).toBe("fail");
  });
});

const vector = (series: Record<string, string>) =>
  JSON.stringify({
    status: "success",
    data: {
      resultType: "vector",
      result: Object.entries(series).map(([job, value]) => ({
        metric: { __name__: "probe_success", job },
        value: [1_794_632_140.942, value],
      })),
    },
  });

describe("blackbox probes", () => {
  const probes = [
    probe("probe-a", "http_2xx", "http://a/", { namespace: "x" }),
    probe("probe-b", "http_2xx", "http://b/", { namespace: "x" }),
    probe("probe-c", "http_2xx", "http://c/", { namespace: "x" }),
  ];

  test("every job must report 1; 0 and a missing series fail", () => {
    const success = parseProbeSuccess(
      vector({ "probe-a": "1", "probe-b": "0" }),
    );
    const result = evaluateProbes(probes, success);
    expect(result.status).toBe("fail");
    expect(result.details).toEqual([
      "probe-b: probe_success 0",
      "probe-c: no probe_success series",
    ]);
    expect(evaluateProbes(probes.slice(0, 1), success).status).toBe("pass");
  });
  test("an unreadable Prometheus is not-checked, never a pass", () => {
    for (const stdout of [
      "",
      "not json",
      JSON.stringify({ status: "error" }),
    ]) {
      const success = parseProbeSuccess(stdout);
      expect(success.available).toBe(false);
      expect(evaluateProbes(probes, success).status).toBe("not-checked");
    }
    expect(
      evaluateProbes(probes, { available: false, reason: "toolkit missing" })
        .summary,
    ).toBe("not checked: toolkit missing");
  });

  test("a namespace without probe targets is an observation", () => {
    expect(evaluateProbes([], parseProbeSuccess(vector({}))).status).toBe(
      "info",
    );
  });
});

describe("denials", () => {
  const lines = [
    "[pod/kube-flannel-a] verdict=deny tracker/tracker-0 -> flipt/flipt-0:8080",
    "[pod/kube-flannel-a] verdict=accept tracker/tracker-0 -> kube-system/dns",
    "[pod/kube-flannel-b] packet dropped my-tracker/x -> media/plex",
    "[pod/kube-flannel-b] Denied by policy: media/plex -> tracker/tracker-0",
  ];

  test("are lines that look like a denial and name the namespace as a word", () => {
    expect(denialsFor("tracker", lines)).toEqual([lines[0], lines[3]]);
    expect(denialsFor("media", lines)).toEqual([lines[2], lines[3]]);
  });

  test("are a note, and not available without the enforcer", () => {
    expect(
      evaluateDenials("tracker", { available: true, lines, minutes: 10 }),
    ).toMatchObject({
      status: "info",
      summary: "2 log lines look like denials in the last 10m",
    });
    expect(
      evaluateDenials("tracker", { available: false, reason: "no container" }),
    ).toMatchObject({ status: "info", summary: "not available: no container" });
  });
});

const result = (
  id: CheckResult["check"],
  status: CheckResult["status"],
  details: string[] = [],
): CheckResult => ({ check: id, status, summary: `${id} summary`, details });

describe("stage and aggregation", () => {
  test("the stage is an observation unless unrecognized or unexpected", () => {
    expect(evaluateStage("none", undefined)).toMatchObject({
      status: "info",
      summary: "no staging policy",
    });
    expect(evaluateStage("enforced", "enforced").status).toBe("info");
    expect(evaluateStage("unrecognized", undefined).status).toBe("fail");
    expect(evaluateStage("open", "enforced")).toMatchObject({
      status: "fail",
      summary: "open, expected enforced",
    });
  });

  test("a namespace passes unless a check failed; unchecked is called out", () => {
    const passing = namespaceReport("tracker", "open", [
      result("stage", "info"),
      result("pods", "pass"),
      result("probes", "not-checked"),
    ]);
    expect(passing.ok).toBe(true);
    expect(renderReport(passing)).toBe(
      [
        "Namespace tracker",
        "INFO         stage   stage summary",
        "PASS         pods    pods summary",
        "NOT CHECKED  probes  probes summary",
        "Result: PASS (with unchecked)",
      ].join("\n"),
    );
    const failing = namespaceReport("media", "enforced", [
      result("pods", "pass"),
      result("urls", "fail", ["public https://plex: HTTP 502"]),
    ]);
    expect(failing.ok).toBe(false);
    expect(renderReport(failing)).toContain(
      "    - public https://plex: HTTP 502",
    );
    expect(renderTable([passing, failing])).toBe(
      [
        "NAMESPACE  STAGE     PODS  SERVICES  URLS  PROBES       DENIALS  RESULT",
        "tracker    open      PASS  -         -     NOT CHECKED  -        PASS (with unchecked)",
        "media      enforced  PASS  -         FAIL  -            -        FAIL",
        "",
        "media urls: urls summary",
        "    - public https://plex: HTTP 502",
        "1/2 namespaces pass",
      ].join("\n"),
    );
  });
});
