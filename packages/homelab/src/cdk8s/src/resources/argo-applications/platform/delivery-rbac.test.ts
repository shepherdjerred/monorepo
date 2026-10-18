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
test("every reviewed workload can execute with its ordinary capability, while root and controller mutations are denied", async () => {
  for (const application of DELIVERY_WORKLOAD_APPLICATIONS)
    for (const action of ["get", "update", "sync"])
      expect(
        await permits("delivery", action, application),
        `${application}:${action}`,
      ).toBe(true);
  for (const application of [
    "apps",
    "argocd",
    "delivery-control-plane",
    "unregistered",
  ])
    for (const action of ["sync", "update", "override", "delete"])
      expect(
        await permits("delivery", action, application),
        `${application}:${action}`,
      ).toBe(false);
});
test("observer reads each exact workload and controller but cannot mutate, stream logs or exec", async () => {
  for (const application of [
    "apps",
    "delivery-control-plane",
    ...DELIVERY_WORKLOAD_APPLICATIONS,
  ])
    expect(await permits("delivery-observer", "get", application)).toBe(true);
  for (const action of ["update", "sync", "override", "delete"])
    expect(await permits("delivery-observer", action, "storm-forum")).toBe(
      false,
    );
  expect(await permits("delivery-observer", "get", "argocd")).toBe(false);
  expect(await permits("delivery-observer", "get", "storm-forum", "logs")).toBe(
    false,
  );
  expect(
    await permits("delivery-observer", "create", "storm-forum", "exec"),
  ).toBe(false);
});
test("platform owns root's guarded overrides and isolated controller, with only sync on root children", async () => {
  const scale = "update/apps/Deployment/temporal/temporal-delivery-worker";
  expect(
    await permits("delivery-platform", scale, "delivery-control-plane"),
  ).toBe(true);
  for (const account of ["delivery", "delivery-observer", "woodpecker"])
    expect(await permits(account, scale, "delivery-control-plane")).toBe(false);
  for (const action of [
    "update/apps/Deployment/temporal/temporal-delivery-platform-worker",
    "update/apps/Deployment/temporal/temporal-delivery-workflows",
    "delete/apps/Deployment/temporal/temporal-delivery-worker",
    "update//Pod/temporal/temporal-delivery-worker",
  ])
    expect(
      await permits("delivery-platform", action, "delivery-control-plane"),
    ).toBe(false);
  expect(await permits("delivery-platform", scale, "temporal")).toBe(false);
  for (const action of ["get", "update", "sync", "override"])
    expect(await permits("delivery-platform", action, "apps")).toBe(true);
  for (const application of DELIVERY_ROOT_APPLICATIONS)
    expect(
      await permits("delivery-platform", "sync", application),
      application,
    ).toBe(true);
  for (const action of ["get", "update", "sync"])
    expect(
      await permits("delivery-platform", action, "delivery-control-plane"),
    ).toBe(true);
  for (const application of ["arcade", "scout-prod", "temporal", "storm-forum"])
    for (const action of ["update", "sync", "override", "delete"])
      expect(await permits("delivery-platform", action, application)).toBe(
        false,
      );
  expect(
    await permits("delivery-platform", "override", "delivery-control-plane"),
  ).toBe(false);
  expect(await permits("delivery-platform", "update", "argocd")).toBe(false);
  expect(await permits("woodpecker", "sync", "apps")).toBe(false);
});
test("registered Argo and controller destinations are covered by the reviewed account split", async () => {
  const root = new URL(
    "../../../../../../../delivery/registrations/",
    import.meta.url,
  );
  const files = [
    ...new Bun.Glob("**/pipeline.json").scanSync({ cwd: root.pathname }),
  ];
  expect(files.length).toBeGreaterThan(20);
  for (const file of files) {
    const raw: unknown = await Bun.file(new URL(file, root)).json();
    const definition = z
      .object({ kind: z.string(), application: z.string().optional() })
      .parse(raw);
    if (definition.kind !== "argocd" && definition.kind !== "control-plane")
      continue;
    const application = z.string().parse(definition.application);
    expect(
      await permits(
        application === "delivery-control-plane"
          ? "delivery-platform"
          : "delivery",
        "update",
        application,
      ),
      file,
    ).toBe(true);
  }
});
