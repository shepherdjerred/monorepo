/**
 * Rendered Alertmanager routing and custom email template tests.
 *
 * These tests inspect the post-Helm apps manifest, then evaluate the rendered
 * route tree and custom Go email template using the post-Helm Alertmanager
 * configuration. Keeping this independent of the source objects catches
 * accidental route ordering, receiver, or Helm-escaping regressions before
 * ArgoCD applies the monitoring stack.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { parseAllDocuments, stringify } from "yaml";
import { z } from "zod";
import { chartValidationValues } from "homelab/scripts/helm/helm-delivery-publication.ts";

const CDK8S_DIR = import.meta.dir.replace(/\/src\/resources\/monitoring$/u, "");
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

const EXPECTED_EMAIL_CONFIG = {
  send_resolved: false,
  to: "alerts@sjer.red",
  headers: {
    Subject: '{{ template "ops.email.subject" . }}',
  },
  html: '{{ template "ops.email.html" . }}',
  text: '{{ template "ops.email.text" . }}',
};

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
  const validationPath = `${chartDir}/validation.yaml`;
  await Bun.write(validationPath, stringify(chartValidationValues("apps")));
  try {
    return await Bun.$`helm template test-release ${chartDir} --values ${validationPath}`.text();
  } finally {
    await Bun.$`rm -rf ${chartDir}`;
  }
}

/** Every mapping in the rendered documents that the predicate accepts. */
function findRecords(
  rendered: string,
  accept: (record: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child));
      return;
    }
    const record = RecordSchema.safeParse(node);
    if (!record.success) return;
    if (accept(record.data)) found.push(record.data);
    Object.values(record.data).forEach((value) => visit(value));
  };
  parseAllDocuments(rendered).forEach((document) => visit(document.toJS()));
  return found;
}

/** The single match, or a failure naming what was looked for. */
function onlyRecord(
  found: Record<string, unknown>[],
  description: string,
): Record<string, unknown> {
  const [record] = found;
  if (record === undefined || found.length !== 1) {
    throw new Error(
      `expected one ${description}, found ${String(found.length)}`,
    );
  }
  return record;
}

/**
 * Receivers are addressed by name because more than one now carries the same
 * kind of config. Matching on the presence of a config key instead would make
 * every such assertion ambiguous the moment a second receiver grows one.
 */
function findReceiverNamed(
  rendered: string,
  name: string,
): Record<string, unknown> {
  return onlyRecord(
    findRecords(
      rendered,
      (record) =>
        record["name"] === name &&
        (Array.isArray(record["email_configs"]) ||
          Array.isArray(record["webhook_configs"])),
    ),
    `receiver named ${name}`,
  );
}

function findReceiver(rendered: string, key: string): Record<string, unknown> {
  return onlyRecord(
    findRecords(rendered, (record) => Array.isArray(record[key])),
    `${key} receiver`,
  );
}

function findAlertmanagerSection(rendered: string): {
  config: Record<string, unknown>;
  opsEmailTemplate: string;
} {
  const alertmanagerRecord = onlyRecord(
    findRecords(
      rendered,
      (record) =>
        RecordSchema.safeParse(record["config"]).success &&
        RecordSchema.safeParse(record["templateFiles"]).success,
    ),
    "Alertmanager Helm values section",
  );
  const config = RecordSchema.parse(alertmanagerRecord["config"]);
  const templateFiles = z
    .record(z.string(), z.string())
    .parse(alertmanagerRecord["templateFiles"]);
  const opsEmailTemplate = templateFiles["ops-email.tmpl"];
  if (opsEmailTemplate === undefined) {
    throw new Error("ops-email.tmpl missing from alertmanager.templateFiles");
  }
  return { config, opsEmailTemplate };
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

const GO_TEMPLATE_HARNESS = `package main

import (
	"bytes"
	"encoding/json"
	htmltemplate "html/template"
	"os"
	texttemplate "text/template"
)

type Alert struct {
	Status      string
	Labels      map[string]string
	Annotations map[string]string
}

type Alerts []Alert

func (a Alerts) Firing() Alerts {
	var out Alerts
	for _, item := range a {
		if item.Status == "firing" {
			out = append(out, item)
		}
	}
	return out
}

type Data struct {
	Receiver     string
	Status       string
	Alerts       Alerts
	CommonLabels map[string]string
}

func main() {
	tmplBytes, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	data := Data{
		Receiver: "postal-fallback",
		Status:   "firing",
		CommonLabels: map[string]string{
			"alertname":                "TemporalWorkflowNondeterministic",
			"severity":                 "critical",
			"alert_dashboard_fallback": "true",
		},
		Alerts: Alerts{
			{
				Status: "firing",
				Labels: map[string]string{
					"alertname":                "TemporalWorkflowNondeterministic",
					"severity":                 "critical",
					"namespace":                "temporal",
					"pod":                      "temporal-worker-7b9d8f-abc12",
					"node":                     "torvalds",
					"workflow_type":            "runHomelabAudit",
					"task_queue":               "monorepo-workflows",
					"instance":                 "10.244.0.48:9100",
					"job":                      "temporal-worker-metrics",
					"endpoint":                 "http-metrics",
					"prometheus":               "prometheus/prometheus-kube-prometheus-prometheus",
					"alert_dashboard_fallback": "true",
				},
				Annotations: map[string]string{
					"summary":     "Workflow stuck after a code change",
					"description": "Workflow runHomelabAudit on queue monorepo-workflows failed replay due to a nondeterministic code change. Pause the worker rollout and test replay before shipping a fix.",
				},
			},
		},
	}

	tt, err := texttemplate.New("ops").Parse(string(tmplBytes))
	if err != nil {
		panic(err)
	}
	ht, err := htmltemplate.New("ops").Parse(string(tmplBytes))
	if err != nil {
		panic(err)
	}

	var subjBuf, textBuf, htmlBuf bytes.Buffer
	if err := tt.ExecuteTemplate(&subjBuf, "ops.email.subject", data); err != nil {
		panic(err)
	}
	if err := tt.ExecuteTemplate(&textBuf, "ops.email.text", data); err != nil {
		panic(err)
	}
	if err := ht.ExecuteTemplate(&htmlBuf, "ops.email.html", data); err != nil {
		panic(err)
	}

	out, err := json.Marshal(map[string]string{
		"subject": subjBuf.String(),
		"text":    textBuf.String(),
		"html":    htmlBuf.String(),
	})
	if err != nil {
		panic(err)
	}
	_, _ = os.Stdout.Write(out)
}
`;

async function validateAndRenderOpsTemplate(
  config: Record<string, unknown>,
  opsEmailTemplate: string,
): Promise<{ subject: string; html: string; text: string } | null> {
  const tempDirResult = await Bun.$`mktemp -d`;
  const tempDir = tempDirResult.text().trim();
  const tmplPath = `${tempDir}/ops-email.tmpl`;
  await Bun.write(tmplPath, opsEmailTemplate);
  try {
    const amtoolPath = Bun.which("amtool");
    if (amtoolPath !== null) {
      const configPath = `${tempDir}/alertmanager.yaml`;
      const sanitizedConfig = stringify({
        ...config,
        global: {
          ...RecordSchema.parse(config["global"]),
          smtp_auth_password: "test-password",
          smtp_auth_password_file: undefined,
          smtp_tls_config: { insecure_skip_verify: false },
        },
        templates: [tmplPath],
        receivers: z
          .array(RecordSchema)
          .parse(config["receivers"])
          .map((receiver) =>
            Array.isArray(receiver["webhook_configs"])
              ? {
                  ...receiver,
                  webhook_configs: receiver["webhook_configs"].map((wh) => ({
                    ...RecordSchema.parse(wh),
                    http_config: undefined,
                  })),
                }
              : receiver,
          ),
      });
      await Bun.write(configPath, sanitizedConfig);
      await Bun.$`${amtoolPath} check-config ${configPath}`.quiet();
    }

    const goPath = Bun.which("go");
    if (goPath === null) return null;
    const harnessPath = `${tempDir}/render.go`;
    await Bun.write(harnessPath, GO_TEMPLATE_HARNESS);
    const rawOutput =
      await Bun.$`${goPath} run ${harnessPath} ${tmplPath}`.text();
    return z
      .object({
        subject: z.string(),
        html: z.string(),
        text: z.string(),
      })
      .parse(JSON.parse(rawOutput));
  } finally {
    await Bun.$`rm -rf ${tempDir}`;
  }
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
          max_alerts: z.number().int().positive(),
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
        max_alerts: 100,
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
    expect(renderedApps).toContain("- alertmanager-postal-smtp");
    expect(renderedApps).toContain("smtp_from: Hub Alerts <alerts@sjer.red>");
    expect(renderedApps).toContain("smtp_auth_username: alertmanager");
    expect(renderedApps).toContain(
      "smtp_auth_password_file: /etc/alertmanager/secrets/alertmanager-postal-smtp/SMTP_PASSWORD",
    );
    expect(renderedApps).toContain("smtp_require_tls: true");
    expect(renderedApps).toContain(
      "ca_file: /etc/alertmanager/secrets/alertmanager-postal-smtp-ca/ca.crt",
    );
    expect(renderedApps).toContain(
      "server_name: postal-postal-smtp-service.postal.svc.cluster.local",
    );
    expect(renderedApps).toContain("insecure_skip_verify: false");
    expect(renderedApps).toContain("- alertmanager-postal-smtp-ca");
    expect(renderedApps).not.toContain("claude@sjer.red");
    expect(renderedApps).not.toContain("smtp_require_tls: false");
    expect(renderedApps).not.toMatch(/smtp_auth_password:\s+[^_]/u);
  });

  it("keeps an independent Postal fallback for dashboard health alerts", () => {
    const receiver = findReceiverNamed(renderedApps, "postal-fallback");
    expect(receiver["email_configs"]).toEqual([EXPECTED_EMAIL_CONFIG]);
    // The whole point of this receiver: it reports on the webhook, so it must
    // not depend on the webhook to be delivered.
    expect(receiver["webhook_configs"]).toBeUndefined();
  });

  it("delivers ordinary alerts to both the ledger and email", () => {
    const receiver = findReceiverNamed(renderedApps, "alerts");
    // The ledger must keep receiving everything; email is additive, not a
    // replacement, or a mail outage silently stops recording alerts.
    expect(receiver["webhook_configs"]).toEqual([
      expect.objectContaining({
        url: expect.stringContaining(
          "/internal/v1/alertmanager/events",
        ) as unknown,
      }),
    ]);
    expect(receiver["email_configs"]).toEqual([EXPECTED_EMAIL_CONFIG]);
  });

  it("renders Hub Editorial HTML, subject, and text from the post-Helm ops-email.tmpl", async () => {
    const { config, opsEmailTemplate } = findAlertmanagerSection(renderedApps);
    const configYaml = stringify(config);

    // Post-Helm output must have zero leftover Helm escape wrappers.
    expect(configYaml).not.toContain('{{ "{{" }}');
    expect(configYaml).not.toContain('{{ "}}" }}');
    expect(opsEmailTemplate).not.toContain('{{ "{{" }}');
    expect(opsEmailTemplate).not.toContain('{{ "}}" }}');
    expect(opsEmailTemplate).toContain('define "ops.email.subject"');
    expect(opsEmailTemplate).toContain('define "ops.email.html"');
    expect(opsEmailTemplate).toContain('define "ops.email.text"');

    const openCount = (opsEmailTemplate.match(/\{\{/gu) ?? []).length;
    const closeCount = (opsEmailTemplate.match(/\}\}/gu) ?? []).length;
    expect(openCount).toBeGreaterThan(20);
    expect(openCount).toBe(closeCount);

    const rendered = await validateAndRenderOpsTemplate(
      config,
      opsEmailTemplate,
    );
    if (rendered !== null) {
      expect(rendered.subject).toBe(
        "Fallback: Workflow stuck after a code change",
      );
      expect(rendered.subject).not.toContain("\n");
      expect(rendered.html).toContain("<!DOCTYPE html>");
      expect(rendered.html).toContain("Open Hub Alerts");
      expect(rendered.html).toContain(
        "https://alerts.tailnet-1a49.ts.net/alerts",
      );
      expect(rendered.html).toContain("Workflow stuck after a code change");
      expect(rendered.html).toContain("Technical details");
      expect(rendered.html).toContain("runHomelabAudit");
      expect(rendered.html).toContain("monorepo-workflows");
      expect(rendered.html).not.toContain("10.244.0.48:9100");
      expect(rendered.html).not.toContain("temporal-worker-metrics");
      expect(rendered.html).not.toContain("http-metrics");
      expect(rendered.html).not.toContain("ZgotmplZ");
      expect(rendered.text).toContain(
        "Open Hub Alerts: https://alerts.tailnet-1a49.ts.net/alerts",
      );
      expect(rendered.text).toContain("Workflow stuck after a code change");
      expect(rendered.text).not.toContain("10.244.0.48:9100");
    }
  }, 30_000);
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

  it("keeps info-level dashboard-namespace alerts suppressed instead of paging Postal", () => {
    expect(
      resolveReceiver(route, {
        alertname: "SomethingInfo",
        namespace: "alert-dashboard",
        severity: "info",
      }),
    ).toBe("null");
  });

  it("routes only webhook-integration delivery failures to Postal", () => {
    expect(
      resolveReceiver(route, {
        alertname: "AlertmanagerFailedToSendAlerts",
        namespace: "prometheus",
        severity: "warning",
        integration: "webhook",
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

  it("routes the cluster-wide webhook delivery-failure alert to Postal alongside its single-instance sibling", () => {
    expect(
      resolveReceiver(route, {
        alertname: "AlertmanagerClusterFailedToSendAlerts",
        namespace: "prometheus",
        severity: "critical",
        integration: "webhook",
      }),
    ).toBe("postal-fallback");
  });

  it("keeps email-integration delivery failures off the broken Postal path", () => {
    expect(
      resolveReceiver(route, {
        alertname: "AlertmanagerFailedToSendAlerts",
        namespace: "monitoring",
        severity: "warning",
        integration: "email",
      }),
    ).toBe("alerts");
  });

  it("does not blanket-route unrelated Alertmanager health alerts to Postal", () => {
    expect(
      resolveReceiver(route, {
        alertname: "AlertmanagerConfigInconsistent",
        namespace: "monitoring",
        severity: "critical",
      }),
    ).toBe("alerts");
  });

  it("keeps Watchdog and info alerts suppressed", () => {
    expect(resolveReceiver(route, { alertname: "Watchdog" })).toBe("null");
    expect(
      resolveReceiver(route, { alertname: "SomethingInfo", severity: "info" }),
    ).toBe("null");
  });

  it("groups Temporal failures through the normal namespace and alertname route", () => {
    const temporalRoute = (route.routes ?? []).find((candidate) =>
      (candidate.matchers ?? []).includes(
        'alertname = "TemporalWorkflowFailed"',
      ),
    );
    expect(temporalRoute).toBeUndefined();
    expect(route.group_by).toEqual(["namespace", "alertname"]);
    expect(
      resolveReceiver(route, {
        alertname: "TemporalWorkflowFailed",
        severity: "warning",
      }),
    ).toBe("alerts");
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
