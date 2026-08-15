/**
 * Rendered Alertmanager routing tests.
 *
 * These tests inspect the post-Helm apps manifest, then evaluate the rendered
 * route tree using the same first-match semantics Alertmanager uses. Keeping
 * this independent of the source objects catches accidental route ordering or
 * receiver regressions before ArgoCD applies the monitoring stack.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { parseAllDocuments } from "yaml";
import { z } from "zod";

const CDK8S_DIR = import.meta.dir.replace(/\/src$/u, "");
const DIST_DIR = `${CDK8S_DIR}/dist`;
const HELM_DIR = `${CDK8S_DIR}/helm`;

const RecordSchema = z.record(z.string(), z.unknown());

type RouteNode = {
  receiver?: string;
  matchers?: string[];
  group_by?: string[];
  routes?: RouteNode[];
};

const RouteNodeSchema: z.ZodType<RouteNode> = z.lazy(() =>
  z.object({
    receiver: z.string().optional(),
    matchers: z.array(z.string()).optional(),
    group_by: z.array(z.string()).optional(),
    routes: z.array(RouteNodeSchema).optional(),
  }),
);

let renderedApps = "";

async function renderApps(): Promise<string> {
  const manifestPath = `${DIST_DIR}/apps.k8s.yaml`;
  const tempDirResult = await Bun.$`mktemp -d`;
  const chartDir = tempDirResult.text().trim();
  const chartYaml = await Bun.file(`${HELM_DIR}/apps/Chart.yaml`).text();
  await Bun.write(
    `${chartDir}/Chart.yaml`,
    chartYaml
      .replace("$version", "0.0.0-test")
      .replace("$appVersion", "0.0.0-test"),
  );
  await Bun.write(
    `${chartDir}/templates/apps.k8s.yaml`,
    Bun.file(manifestPath),
  );
  const result = await Bun.$`helm template test-release ${chartDir}`.text();
  await Bun.$`rm -rf ${chartDir}`;
  return result;
}

function findReceiver(rendered: string, key: string): Record<string, unknown> {
  const found: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child));
      return;
    }
    const record = RecordSchema.safeParse(node);
    if (!record.success) return;
    if (Array.isArray(record.data[key])) {
      found.push(record.data);
    }
    Object.values(record.data).forEach((value) => visit(value));
  };
  parseAllDocuments(rendered).forEach((document) => visit(document.toJS()));
  if (found.length !== 1) {
    throw new Error(
      `expected one ${key} receiver, found ${String(found.length)}`,
    );
  }
  const receiver = found[0];
  if (receiver === undefined) throw new Error(`${key} receiver missing`);
  return receiver;
}

function findAlertmanagerRoute(rendered: string): RouteNode {
  const found: RouteNode[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child));
      return;
    }
    const record = RecordSchema.safeParse(node);
    if (!record.success) return;
    const route = RouteNodeSchema.safeParse(record.data["route"]);
    if (route.success && route.data.routes !== undefined)
      found.push(route.data);
    Object.values(record.data).forEach((value) => visit(value));
  };
  parseAllDocuments(rendered).forEach((document) => visit(document.toJS()));
  if (found.length !== 1) {
    throw new Error(
      `expected one Alertmanager route, found ${String(found.length)}`,
    );
  }
  const route = found[0];
  if (route === undefined) throw new Error("Alertmanager route missing");
  return route;
}

const MATCHER_RE = /^(\w+)\s*(=~|!~|!=|=)(.*)$/u;

function matcherMatches(
  matcher: string,
  labels: Record<string, string>,
): boolean {
  const match = MATCHER_RE.exec(matcher.trim());
  if (match === null) throw new Error(`unparseable matcher: ${matcher}`);
  const name = match[1] ?? "";
  const operator = match[2] ?? "";
  const value = (match[3] ?? "").trim().replace(/^"(.*)"$/u, "$1");
  const actual = labels[name] ?? "";
  switch (operator) {
    case "=":
      return actual === value;
    case "!=":
      return actual !== value;
    case "=~":
      return new RegExp(`^(?:${value})$`, "u").test(actual);
    case "!~":
      return !new RegExp(`^(?:${value})$`, "u").test(actual);
    default:
      throw new Error(`unknown matcher operator: ${operator}`);
  }
}

function resolveReceiver(
  route: RouteNode,
  labels: Record<string, string>,
): string | undefined {
  for (const child of route.routes ?? []) {
    if (
      (child.matchers ?? []).every((matcher) => matcherMatches(matcher, labels))
    ) {
      return child.receiver ?? route.receiver;
    }
  }
  return route.receiver;
}

describe("rendered Alerts receiver", () => {
  beforeAll(async () => {
    renderedApps = await renderApps();
  }, 120_000);

  it("posts Alertmanager events to the authenticated Alerts endpoint", () => {
    const receiver = findReceiver(renderedApps, "webhook_configs");
    const configs = z
      .array(
        z.object({
          send_resolved: z.boolean(),
          url: z.string(),
          http_config: z.object({
            authorization: z.object({
              type: z.string(),
              credentials_file: z.string(),
            }),
          }),
        }),
      )
      .parse(receiver["webhook_configs"]);
    expect(configs).toEqual([
      {
        send_resolved: true,
        url: "http://alert-dashboard-alert-dashboard-service.alert-dashboard.svc.cluster.local:7341/internal/v1/alertmanager/events",
        http_config: {
          authorization: {
            type: "Bearer",
            credentials_file:
              "/etc/alertmanager/secrets/alert-dashboard-secrets/WEBHOOK_TOKEN",
          },
        },
      },
    ]);
    expect(renderedApps).toContain(
      "itemPath: vaults/v64ocnykdqju4ui6j6pua56xw4/items/alert-dashboard",
    );
    expect(renderedApps).toContain(
      "secrets:\n              - alert-dashboard-secrets",
    );
  });

  it("keeps an independent Postal fallback for dashboard health alerts", () => {
    const receiver = findReceiver(renderedApps, "email_configs");
    expect(receiver["email_configs"]).toEqual([
      { send_resolved: false, to: "claude@sjer.red" },
    ]);
  });
});

describe("Alerts route selection", () => {
  let route: RouteNode;

  beforeAll(async () => {
    if (renderedApps === "") renderedApps = await renderApps();
    route = findAlertmanagerRoute(renderedApps);
  }, 120_000);

  it("routes normal warning and critical alerts to Alerts", () => {
    expect(
      resolveReceiver(route, {
        alertname: "XcodeCloudBuildFailed",
        severity: "warning",
      }),
    ).toBe("alerts");
    expect(
      resolveReceiver(route, {
        alertname: "KubePodCrashLooping",
        severity: "critical",
      }),
    ).toBe("alerts");
  });

  it("routes dashboard health alerts to Postal", () => {
    expect(
      resolveReceiver(route, {
        alertname: "AlertDashboardDown",
        severity: "critical",
        alert_dashboard_fallback: "true",
      }),
    ).toBe("postal-fallback");
    expect(
      resolveReceiver(route, {
        alertname: "ServiceProbeDown",
        namespace: "alert-dashboard",
        severity: "warning",
      }),
    ).toBe("postal-fallback");
  });

  it("routes notification delivery health alerts to Postal", () => {
    expect(
      resolveReceiver(route, {
        alertname: "AlertmanagerFailedToSendAlerts",
        namespace: "prometheus",
        severity: "warning",
      }),
    ).toBe("postal-fallback");
    expect(
      resolveReceiver(route, {
        alertname: "PrometheusErrorSendingAlertsToSomeAlertmanagers",
        namespace: "prometheus",
        severity: "warning",
      }),
    ).toBe("postal-fallback");
  });

  it("keeps Watchdog and info alerts suppressed", () => {
    expect(resolveReceiver(route, { alertname: "Watchdog" })).toBe("null");
    expect(
      resolveReceiver(route, { alertname: "SomethingInfo", severity: "info" }),
    ).toBe("null");
  });

  it("keeps Temporal failures grouped by execution while using Alerts", () => {
    const temporalRoute = (route.routes ?? []).find((candidate) =>
      (candidate.matchers ?? []).includes(
        'alertname = "TemporalWorkflowFailed"',
      ),
    );
    expect(temporalRoute?.receiver).toBe("alerts");
    expect(temporalRoute?.group_by).toEqual([
      "alertname",
      "workflowId",
      "runId",
    ]);
  });

  it("does not notify on removed aggregate timeout alerts", () => {
    expect(
      resolveReceiver(route, {
        alertname: "TemporalAgentTaskTimingOut",
        severity: "warning",
      }),
    ).toBe("null");
    expect(
      resolveReceiver(route, {
        alertname: "TemporalAgentTaskTimeoutScanFailed",
        severity: "warning",
      }),
    ).toBe("null");
  });
});
