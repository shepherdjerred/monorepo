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

function findInhibitRules(rendered: string): unknown[] {
  const record = onlyRecord(
    findRecords(rendered, (candidate) =>
      Array.isArray(candidate["inhibit_rules"]),
    ),
    "Alertmanager inhibit_rules",
  );
  return z.array(z.unknown()).parse(record["inhibit_rules"]);
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

const WebhookConfigsSchema = z.array(
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
);

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

const GO_HARNESS_PATH = `${CDK8S_DIR}/../../../ops-model/scripts/alertmanager-render.go`;

async function validateAndRenderOpsTemplate(
  config: Record<string, unknown>,
  opsEmailTemplate: string,
  scenario: "single" | "multi" = "single",
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
    const rawOutput =
      await Bun.$`${goPath} run ${GO_HARNESS_PATH} ${tmplPath} ${scenario}`.text();
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
    const expectedWebhookConfigs = [
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
    ];
    for (const receiverName of ["alerts", "alerts-ledger-only"]) {
      const receiver = findReceiverNamed(renderedApps, receiverName);
      expect(WebhookConfigsSchema.parse(receiver["webhook_configs"])).toEqual(
        expectedWebhookConfigs,
      );
    }
    expect(renderedApps).toContain(
      "itemPath: vaults/v64ocnykdqju4ui6j6pua56xw4/items/alert-dashboard",
    );
    expect(renderedApps).toContain(
      "secrets:\n              - alert-dashboard-secrets",
    );
    expect(renderedApps).toContain("- alertmanager-mail-smtp");
    expect(renderedApps).toContain("smtp_from: Hub Alerts <alerts@sjer.red>");
    expect(renderedApps).toContain("smtp_auth_username: alertmanager");
    expect(renderedApps).toContain(
      "smtp_auth_password_file: /etc/alertmanager/secrets/alertmanager-mail-smtp/SMTP_PASSWORD",
    );
    expect(renderedApps).toContain("smtp_require_tls: true");
    expect(renderedApps).toContain(
      "ca_file: /etc/alertmanager/secrets/alertmanager-mail-smtp-ca/ca.crt",
    );
    expect(renderedApps).toContain("server_name: mail.mail.svc.cluster.local");
    expect(renderedApps).toContain("insecure_skip_verify: false");
    expect(renderedApps).toContain("- alertmanager-mail-smtp-ca");
    expect(renderedApps).not.toContain("claude@sjer.red");
    expect(renderedApps).not.toContain("smtp_require_tls: false");
    expect(renderedApps).not.toMatch(/smtp_auth_password:\s+[^_]/u);
  });

  it("keeps an independent mail fallback for dashboard health alerts", () => {
    const receiver = findReceiverNamed(renderedApps, "mail-fallback");
    expect(receiver["email_configs"]).toEqual([EXPECTED_EMAIL_CONFIG]);
    // The whole point of this receiver: it reports on the webhook, so it must
    // not depend on the webhook to be delivered.
    expect(receiver["webhook_configs"]).toBeUndefined();
  });

  it("delivers ordinary and ledger-only alerts to the Hub webhook only so Hub's outbox is the single email sender", () => {
    const receiver = findReceiverNamed(renderedApps, "alerts");
    expect(receiver["webhook_configs"]).toEqual([
      expect.objectContaining({
        url: expect.stringContaining(
          "/internal/v1/alertmanager/events",
        ) as unknown,
      }),
    ]);
    expect(receiver["email_configs"]).toBeUndefined();

    const ledgerOnly = findReceiverNamed(renderedApps, "alerts-ledger-only");
    expect(ledgerOnly["webhook_configs"]).toEqual([
      expect.objectContaining({
        url: expect.stringContaining(
          "/internal/v1/alertmanager/events",
        ) as unknown,
      }),
    ]);
    expect(ledgerOnly["email_configs"]).toBeUndefined();
  });

  it("inhibits redundant Temporal schedule, activity, and ZFS alerts when TemporalWorkflowFailed fires", () => {
    const activityTarget = [
      "TemporalWorkflowActivityFailing",
      "TemporalActivityRetriesExhausted",
    ].join("|");
    const inhibitRules = findInhibitRules(renderedApps);
    expect(inhibitRules).toEqual(
      expect.arrayContaining([
        {
          source_matchers: ["alertname = TemporalWorkflowFailed"],
          target_matchers: ["alertname = TemporalScheduledCurrentFailure"],
          equal: ["exported_namespace", "schedule_id"],
        },
        {
          source_matchers: ["alertname = TemporalWorkflowFailed"],
          target_matchers: [`alertname =~ ${activityTarget}`],
          equal: ["exported_namespace", "workflowType"],
        },
        {
          source_matchers: [
            "alertname = TemporalWorkflowFailed",
            "workflowType = runZfsMaintenanceWorkflow",
          ],
          target_matchers: ["alertname = ZfsMaintenanceFailed"],
        },
      ]),
    );
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
      expect(rendered.html).toContain("https://hub.tailnet-1a49.ts.net/alerts");
      expect(rendered.html).toContain("Workflow stuck after a code change");
      expect(rendered.html).toContain("Technical details");
      expect(rendered.html).toContain("runHomelabAudit");
      expect(rendered.html).toContain("monorepo-workflows");
      expect(rendered.html).not.toContain("10.244.0.48:9100");
      expect(rendered.html).not.toContain("temporal-worker-metrics");
      expect(rendered.html).not.toContain("http-metrics");
      expect(rendered.html).not.toContain("ZgotmplZ");
      expect(rendered.text).toContain(
        "Open Hub Alerts: https://hub.tailnet-1a49.ts.net/alerts",
      );
      expect(rendered.text).toContain("Workflow stuck after a code change");
      expect(rendered.text).not.toContain("10.244.0.48:9100");
    }
  }, 30_000);

  it("groups a multi-alert fallback email by severity with the details helper", async () => {
    const { config, opsEmailTemplate } = findAlertmanagerSection(renderedApps);
    const rendered = await validateAndRenderOpsTemplate(
      config,
      opsEmailTemplate,
      "multi",
    );
    if (rendered !== null) {
      expect(rendered.html).not.toContain("ZgotmplZ");
      expect(rendered.html).toContain("3 active alerts need attention");
      expect(rendered.html).toContain("Critical</span>");
      expect(rendered.html).toContain("Warning</span>");
      expect(rendered.html).toContain("CI cache disk is 83% full");
      expect(rendered.html).toContain("woodpecker-cache-pvc");
      expect(rendered.html).toContain("Technical details");
      expect(rendered.html).not.toContain("border-top:3px");
      expect(rendered.text).toContain("ZFS pool: tank");
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

  it("routes dashboard health alerts to mail-fallback", () => {
    expect(
      resolveReceiver(route, {
        alertname: "AlertDashboardDown",
        severity: "critical",
        alert_dashboard_fallback: "true",
      }),
    ).toBe("mail-fallback");
    expect(
      resolveReceiver(route, {
        alertname: "ServiceProbeDown",
        namespace: "alert-dashboard",
        severity: "warning",
      }),
    ).toBe("mail-fallback");
  });

  it("keeps info-level dashboard-namespace alerts suppressed instead of paging mail-fallback", () => {
    expect(
      resolveReceiver(route, {
        alertname: "SomethingInfo",
        namespace: "alert-dashboard",
        severity: "info",
      }),
    ).toBe("null");
  });

  it("routes only webhook-integration delivery failures to mail-fallback", () => {
    expect(
      resolveReceiver(route, {
        alertname: "AlertmanagerFailedToSendAlerts",
        namespace: "prometheus",
        severity: "warning",
        integration: "webhook",
      }),
    ).toBe("mail-fallback");
    expect(
      resolveReceiver(route, {
        alertname: "PrometheusErrorSendingAlertsToSomeAlertmanagers",
        namespace: "prometheus",
        severity: "warning",
      }),
    ).toBe("mail-fallback");
  });

  it("routes the cluster-wide webhook delivery-failure alert to mail-fallback alongside its single-instance sibling", () => {
    expect(
      resolveReceiver(route, {
        alertname: "AlertmanagerClusterFailedToSendAlerts",
        namespace: "prometheus",
        severity: "critical",
        integration: "webhook",
      }),
    ).toBe("mail-fallback");
  });

  it("keeps email-integration delivery failures off the broken mail SMTP path", () => {
    expect(
      resolveReceiver(route, {
        alertname: "AlertmanagerFailedToSendAlerts",
        namespace: "monitoring",
        severity: "warning",
        integration: "email",
      }),
    ).toBe("alerts");
  });

  it("does not blanket-route unrelated Alertmanager health alerts to mail-fallback", () => {
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

  it("routes warning household chores to alerts-ledger-only while keeping critical household and info rules on their expected paths", () => {
    expect(
      resolveReceiver(route, {
        alertname: "RoborockDirtyWaterTankFull",
        category: "household",
        severity: "warning",
      }),
    ).toBe("alerts-ledger-only");
    expect(
      resolveReceiver(route, {
        alertname: "LitterRobotWasteCritical",
        category: "household",
        severity: "critical",
      }),
    ).toBe("alerts");
    expect(
      resolveReceiver(route, {
        alertname: "VacuumRunInterrupted",
        category: "household",
        severity: "info",
      }),
    ).toBe("null");
    expect(
      resolveReceiver(route, {
        alertname: "PetCareEntityUnavailable",
        severity: "warning",
      }),
    ).toBe("alerts");
  });
});
