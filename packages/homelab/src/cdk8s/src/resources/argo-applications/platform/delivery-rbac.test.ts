import { afterAll, beforeAll, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import { createArgoCdApp } from "./argocd.ts";
import {
  DELIVERY_WORKLOAD_APPLICATIONS,
  DELIVERY_ROOT_APPLICATIONS,
} from "./delivery-rbac.ts";

let directory: string;
let policyFile: string;
let kubeconfig: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "delivery-argo-rbac-"));
  policyFile = path.join(directory, "policy.yaml");
  kubeconfig = path.join(directory, "kubeconfig");
  // Argo constructs a client even for local policy evaluation. This deliberately
  // unreachable fixture prevents inheriting any operator context or credentials.
  await Bun.write(
    kubeconfig,
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [
        { name: "offline", cluster: { server: "http://127.0.0.1:1" } },
      ],
      users: [{ name: "offline", user: {} }],
      contexts: [
        { name: "offline", context: { cluster: "offline", user: "offline" } },
      ],
      "current-context": "offline",
    }),
  );
  const chart = new Chart(new App(), "argocd-permissions");
  createArgoCdApp(chart);
  const application = chart.toJson().find(
    (raw: unknown) =>
      z
        .object({
          kind: z.literal("Application"),
          metadata: z.object({ name: z.literal("argocd") }),
        })
        .safeParse(raw).success,
  );
  const config = z
    .object({
      spec: z.object({
        source: z.object({
          helm: z.object({
            valuesObject: z.object({
              configs: z.object({
                rbac: z.object({
                  "policy.csv": z.string(),
                  "policy.default": z.string(),
                }),
                cm: z.record(z.string(), z.json()),
              }),
            }),
          }),
        }),
      }),
    })
    .parse(application);
  const { rbac, cm } = config.spec.source.helm.valuesObject.configs;
  expect(cm["accounts.woodpecker.enabled"]).toBe(false);
  expect(cm["server.rbac.disableApplicationFineGrainedRBACInheritance"]).toBe(
    true,
  );
  for (const account of [
    "delivery",
    "delivery-observer",
    "delivery-platform",
  ]) {
    expect(cm[`accounts.${account}`]).toBe("apiKey");
    expect(cm[`accounts.${account}.enabled`]).toBe(true);
  }
  expect(rbac["policy.default"]).toBe("");
  expect(rbac["policy.csv"]).not.toContain("*");
  await Bun.write(
    policyFile,
    stringify({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "argocd-rbac-cm" },
      data: rbac,
    }),
  );
});
afterAll(async () => {
  await rm(directory, { recursive: true });
});

async function permits(
  subject: string,
  action: string,
  application: string,
  resource = "applications",
) {
  const child = Bun.spawn(
    [
      "argocd",
      "admin",
      "settings",
      "rbac",
      "can",
      subject,
      action,
      resource,
      `default/${application}`,
      "--policy-file",
      policyFile,
      "--use-builtin-policy=false",
      "--kubeconfig",
      kubeconfig,
    ],
    {
      env: { PATH: Bun.env["PATH"] ?? "", HOME: directory },
      timeout: 4000,
      killSignal: "SIGKILL",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 && code !== 1)
    throw new Error(`Native Argo policy evaluation failed: ${stderr}`);
  const result = z.enum(["Yes", "No"]).safeParse(stdout.trim());
  if (!result.success)
    throw new Error(
      `Native Argo policy evaluator returned no decision: ${stderr}`,
    );
  return result.data === "Yes";
}
type PolicyCase = {
  subject: string;
  action: string;
  application: string;
  resource: string;
  allowed: boolean;
};
function cases(
  subject: string,
  applications: readonly string[],
  actions: readonly string[],
  allowed: boolean,
): PolicyCase[] {
  return applications.flatMap((application) =>
    actions.map((action) => ({
      subject,
      action,
      application,
      resource: "applications",
      allowed,
    })),
  );
}
const scale = "update/apps/Deployment/temporal/temporal-delivery-worker";
const permissions: PolicyCase[] = [
  ...cases(
    "delivery",
    DELIVERY_WORKLOAD_APPLICATIONS,
    ["get", "update", "sync"],
    true,
  ),
  ...cases(
    "delivery",
    ["apps", "argocd", "delivery-control-plane", "unregistered"],
    ["sync", "update", "override", "delete"],
    false,
  ),
  ...cases(
    "delivery-observer",
    ["apps", "delivery-control-plane", ...DELIVERY_WORKLOAD_APPLICATIONS],
    ["get"],
    true,
  ),
  ...cases(
    "delivery-observer",
    ["storm-forum"],
    ["update", "sync", "override", "delete"],
    false,
  ),
  ...cases("delivery-observer", ["argocd"], ["get"], false),
  {
    subject: "delivery-observer",
    application: "storm-forum",
    action: "get",
    resource: "logs",
    allowed: false,
  },
  {
    subject: "delivery-observer",
    application: "storm-forum",
    action: "create",
    resource: "exec",
    allowed: false,
  },
  ...cases("delivery-platform", ["delivery-control-plane"], [scale], true),
  ...["delivery", "delivery-observer", "woodpecker"].flatMap((subject) =>
    cases(subject, ["delivery-control-plane"], [scale], false),
  ),
  ...cases(
    "delivery-platform",
    ["delivery-control-plane"],
    [
      "update/apps/Deployment/temporal/temporal-delivery-platform-worker",
      "update/apps/Deployment/temporal/temporal-delivery-workflows",
      "delete/apps/Deployment/temporal/temporal-delivery-worker",
      "update//Pod/temporal/temporal-delivery-worker",
    ],
    false,
  ),
  ...cases("delivery-platform", ["temporal"], [scale], false),
  ...cases(
    "delivery-platform",
    ["apps"],
    ["get", "update", "sync", "override"],
    true,
  ),
  ...cases("delivery-platform", DELIVERY_ROOT_APPLICATIONS, ["sync"], true),
  ...cases(
    "delivery-platform",
    ["delivery-control-plane"],
    ["get", "update", "sync"],
    true,
  ),
  ...cases(
    "delivery-platform",
    ["arcade", "scout-prod", "temporal", "storm-forum"],
    ["update", "sync", "override", "delete"],
    false,
  ),
  ...cases(
    "delivery-platform",
    ["delivery-control-plane"],
    ["override"],
    false,
  ),
  ...cases("delivery-platform", ["argocd"], ["update"], false),
  ...cases("woodpecker", ["apps"], ["sync"], false),
];

test.each(permissions)(
  "$subject $action $resource on $application: allowed=$allowed",
  async ({ subject, action, resource, application, allowed }) => {
    expect(await permits(subject, action, application, resource)).toBe(allowed);
  },
);

const registrationRoot = new URL(
  "../../../../../../../delivery/registrations/",
  import.meta.url,
);
const registrationFiles = [
  ...new Bun.Glob("**/pipeline.json").scanSync({
    cwd: registrationRoot.pathname,
  }),
];
const registrations = await Promise.all(
  registrationFiles.map(async (file) => ({
    file,
    definition: z
      .object({ kind: z.string(), application: z.string().optional() })
      .parse(await Bun.file(new URL(file, registrationRoot)).json()),
  })),
);
test("registered release inventory includes all reviewed application/controller destinations", () => {
  expect(registrationFiles.length).toBeGreaterThan(20);
});
test.each(
  registrations.filter(({ definition }) =>
    ["argocd", "control-plane"].includes(definition.kind),
  ),
)("$file has its exact native update capability", async ({ definition }) => {
  const application = z.string().parse(definition.application);
  expect(
    await permits(
      application === "delivery-control-plane"
        ? "delivery-platform"
        : "delivery",
      "update",
      application,
    ),
  ).toBe(true);
});
