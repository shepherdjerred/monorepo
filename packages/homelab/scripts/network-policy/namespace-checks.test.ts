import { describe, expect, test } from "vitest";
import { failedPod, probe } from "./fixtures.ts";
import {
  evaluatePods,
  evaluateProbes,
  evaluateServices,
  evaluateStage,
  evaluateUrlResponse,
  evaluateUrls,
  evaluateUrlsWithoutPods,
  failedAt,
  namespaceReport,
  parseProbeSuccess,
  PodSchema,
  type CheckResult,
  type Pod,
} from "./namespace-checks.ts";
import { denialsFor, evaluateDenials } from "./namespace-denials.ts";
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

  test("a Failed pod from before the window is noted, not counted", () => {
    const result = evaluatePods(
      [
        pod("web-new"),
        PodSchema.parse(
          failedPod("web-old", {
            created: "2026-11-12T14:00:00Z",
            transitioned: "2026-11-12T15:30:00Z",
            finished: null,
          }),
        ),
      ],
      NOW,
      10,
    );
    expect(result).toEqual({
      check: "pods",
      status: "pass",
      summary: "1/1 pods Ready with no restart in the last 10m",
      details: [
        "web-old: Failed at 2026-11-12T15:30:00.000Z, before the last 10m (not counted)",
      ],
    });
  });

  test("a pod that failed inside the window fails, a Job's included", () => {
    const createdLongAgo = { created: "2026-11-12T00:00:00Z" };
    const result = evaluatePods(
      [
        // A Job pod created a day ago whose container exited a minute ago.
        PodSchema.parse(
          failedPod("migrate-job", {
            ...createdLongAgo,
            transitioned: "2026-11-12T00:00:05Z",
            finished: "2026-11-13T11:59:00Z",
          }),
        ),
        // Refused at admission a minute ago: only a condition carries the time.
        PodSchema.parse(
          failedPod("rejected", {
            ...createdLongAgo,
            transitioned: "2026-11-13T11:59:00Z",
          }),
        ),
      ],
      NOW,
      10,
    );
    expect(result.status).toBe("fail");
    expect(result.details).toEqual([
      "migrate-job: not Ready (Failed)",
      "rejected: not Ready (Failed)",
    ]);
    // A window wide enough to reach an old failure counts it again.
    const old = PodSchema.parse(
      failedPod("web-old", { created: "2026-11-12T14:00:00Z" }),
    );
    expect(evaluatePods([old], NOW, 10).status).toBe("pass");
    expect(evaluatePods([old], NOW, 24 * 60).status).toBe("fail");
  });

  test("a Failed pod's time is its latest finish or transition, else its creation", () => {
    const created = "2026-11-12T00:00:00Z";
    expect(failedAt(PodSchema.parse(failedPod("a", { created })))).toEqual(
      new Date(created),
    );
    expect(
      failedAt(
        PodSchema.parse(
          failedPod("b", {
            created,
            transitioned: "2026-11-12T01:00:00Z",
            finished: "2026-11-12T02:00:00Z",
          }),
        ),
      ),
    ).toEqual(new Date("2026-11-12T02:00:00Z"));
  });

  test("a Failed pod with no time at all is counted", () => {
    const timeless = PodSchema.parse({
      metadata: { name: "timeless" },
      status: { phase: "Failed" },
    });
    expect(failedAt(timeless)).toBeUndefined();
    expect(evaluatePods([timeless], NOW, 10).status).toBe("fail");
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

  test("a namespace that runs no pods notes its URLs without checking them", () => {
    expect(evaluateUrlsWithoutPods(2)).toEqual({
      check: "urls",
      status: "info",
      summary: "namespace runs no pods; 2 URLs not checked",
      details: [],
    });
    expect(evaluateUrlsWithoutPods(1).summary).toBe(
      "namespace runs no pods; 1 URL not checked",
    );
    expect(evaluateUrlsWithoutPods(0)).toEqual(evaluateUrls([], []));
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
  const a = "[kube-flannel-a]";
  const b = "[kube-flannel-b]";
  const [evalA7, deniedA7, evalB7, deniedB7, evalA8, limited] = [
    `${a} I1114 12:00:00.1 1 logging.go:67] "Evaluating packet" id=7 direction="egress" srcPod="tracker/tracker-0" dstPod="flipt/flipt-0"`,
    `${a} I1114 12:00:00.2 1 engine.go:57] "Packet denied by egress policy" id=7`,
    `${b} I1114 12:00:00.3 1 logging.go:67] "Evaluating packet" id=7 direction="ingress" srcPod="my-tracker/x" dstPod="media/plex-0"`,
    `${b} I1114 12:00:00.4 1 engine.go:68] "Packet denied by ingress policy" id=7`,
    `${a} I1114 12:00:00.5 1 logging.go:67] "Evaluating packet" id=8 direction="egress" srcPod="tracker/tracker-0" dstPod="kube-system/coredns-1"`,
    `${b} I1114 12:00:00.6 1 networkpolicy.go:279] "Pod has limited all egress traffic" pod="tracker/tracker-0" policy="tracker/deny-all"`,
  ] as const;
  const lines = [evalA7, deniedA7, evalB7, deniedB7, evalA8, limited];

  test("pair each denial with the same agent's packet line and match the namespace by pod", () => {
    // A deny-all visit is not a verdict: another policy may still allow it.
    expect(denialsFor("tracker", lines)).toEqual([`${deniedA7} <- ${evalA7}`]);
    expect(denialsFor("media", lines)).toEqual([`${deniedB7} <- ${evalB7}`]);
    expect(denialsFor("flipt", lines)).toEqual([`${deniedA7} <- ${evalA7}`]);
    expect(denialsFor("my", lines)).toEqual([]);
    expect(denialsFor("kube-system", lines)).toEqual([]);
  });

  test("the latest evaluation of an id before its denial is the packet", () => {
    // The enforcer evaluates a packet's egress, then its ingress, under one id.
    const egress = `${a} I1120 06:46:59.1 1 logging.go:67] "Evaluating packet" id=9 direction="Egress" srcPod="tracker/client" dstPod="media/server"`;
    const ingress = `${a} I1120 06:46:59.2 1 logging.go:67] "Evaluating packet" id=9 direction="Ingress" srcPod="tracker/client" dstPod="media/server"`;
    const denied = `${a} I1120 06:46:59.3 1 engine.go:68] "Packet denied by ingress policy" id=9`;
    expect(denialsFor("media", [egress, ingress, denied])).toEqual([
      `${denied} <- ${ingress}`,
    ]);
  });

  test("are a note, a lower bound at the Loki limit, and not available without evidence", () => {
    const log = {
      available: true as const,
      lines,
      minutes: 10,
      limitReached: false,
    };
    expect(evaluateDenials("tracker", log)).toMatchObject({
      status: "info",
      summary: "1 denials involving this namespace in the last 10m",
    });
    expect(
      evaluateDenials("tracker", { ...log, limitReached: true }).summary,
    ).toBe(
      "at least 1 denials involving this namespace in the last 10m (a Loki query reached its line limit)",
    );
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

const STAGE = { expected: undefined, allowBreakGlass: false };

describe("stage and aggregation", () => {
  test("the stage is an observation unless unrecognized or unexpected", () => {
    expect(evaluateStage("tracker", "none", "none", STAGE)).toEqual({
      check: "stage",
      status: "info",
      summary: "no staging policy",
      details: [],
    });
    expect(
      evaluateStage("tracker", "enforced", "none", {
        ...STAGE,
        expected: "enforced",
      }).status,
    ).toBe("info");
    expect(evaluateStage("tracker", "unrecognized", "none", STAGE).status).toBe(
      "fail",
    );
    expect(
      evaluateStage("tracker", "open", "none", {
        ...STAGE,
        expected: "enforced",
      }),
    ).toMatchObject({ status: "fail", summary: "open, expected enforced" });
  });

  test("a break-glass policy reads as open and fails unless allowed", () => {
    const forgotten = evaluateStage("tracker", "enforced", "open", STAGE);
    expect(forgotten.status).toBe("fail");
    expect(forgotten.summary).toBe(
      "open (break-glass); staging policy: enforced",
    );
    expect(forgotten.details).toEqual([
      "a break-glass policy is live: reconcile the stage map, then run netpol:open tracker --close --apply (or pass --allow-break-glass)",
    ]);
    expect(
      evaluateStage("tracker", "enforced", "open", {
        ...STAGE,
        allowBreakGlass: true,
      }),
    ).toMatchObject({
      status: "info",
      summary: "open (break-glass); staging policy: enforced",
      details: [],
    });
    expect(evaluateStage("tracker", "none", "open", STAGE).summary).toBe(
      "open (break-glass); staging policy: none",
    );
    expect(
      evaluateStage("tracker", "open", "unrecognized", STAGE),
    ).toMatchObject({
      status: "fail",
      summary: "open (unrecognized break-glass)",
    });
  });

  test("a namespace passes unless a check failed; unchecked is called out", () => {
    const passing = namespaceReport("tracker", "open", "none", [
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
    const failing = namespaceReport("media", "enforced", "open", [
      result("pods", "pass"),
      result("urls", "fail", ["public https://plex: HTTP 502"]),
    ]);
    expect(failing.ok).toBe(false);
    expect(renderReport(failing)).toContain(
      "    - public https://plex: HTTP 502",
    );
    expect(renderTable([passing, failing])).toBe(
      [
        "NAMESPACE  STAGE               PODS  SERVICES  URLS  PROBES       DENIALS  RESULT",
        "tracker    open                PASS  -         -     NOT CHECKED  -        PASS (with unchecked)",
        "media      open (break-glass)  PASS  -         FAIL  -            -        FAIL",
        "",
        "media urls: urls summary",
        "    - public https://plex: HTTP 502",
        "1/2 namespaces pass",
      ].join("\n"),
    );
  });
});
