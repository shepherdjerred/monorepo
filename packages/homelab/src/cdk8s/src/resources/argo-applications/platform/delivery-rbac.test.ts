import { afterAll, beforeAll, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import { createArgoCdApp } from "./argocd.ts";
import { humanArgoCdPolicyRows } from "./argocd-human-access.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import {
  argoRbacAllows,
  writeOfflineKubeconfig,
} from "@shepherdjerred/homelab/cdk8s/src/testing/argocd-rbac.ts";
import {
  DELIVERY_WORKLOAD_APPLICATIONS,
  OPERATOR_RUN_DATA_APPLICATIONS,
  deliveryArgoPolicy,
  deliveryKnownApplications,
  deliveryManagedApplications,
  deliveryRootApplications,
} from "./delivery-rbac.ts";
import { ARGOCD_PROJECTS, applicationProject } from "./projects.ts";

type SwitchState = "off" | "on";
let directory: string;
let kubeconfig: string;
const policyFiles: Record<SwitchState, string> = { off: "", on: "" };
const policyRows: Record<SwitchState, string> = { off: "", on: "" };
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "delivery-argo-rbac-"));
  policyFiles.off = path.join(directory, "policy-off.yaml");
  policyFiles.on = path.join(directory, "policy-on.yaml");
  kubeconfig = await writeOfflineKubeconfig(directory);
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
  // The rendered chart carries the committed switch state; both states are
  // evaluated from the policy itself.
  expect(rbac["policy.csv"]).toBe(
    [
      deliveryArgoPolicy(transitionRendering()),
      ...humanArgoCdPolicyRows(),
    ].join("\n"),
  );
  for (const [state, csv] of [
    ["off", deliveryArgoPolicy(false)],
    ["on", deliveryArgoPolicy(true)],
  ] as const) {
    expect(csv).not.toContain("*");
    policyRows[state] = csv;
    await Bun.write(
      policyFiles[state],
      stringify({
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "argocd-rbac-cm" },
        data: { ...rbac, "policy.csv": csv },
      }),
    );
  }
});
afterAll(async () => {
  await rm(directory, { recursive: true });
});

type PolicyQuery = {
  state: SwitchState;
  subject: string;
  action: string;
  application: string;
  resource?: string;
  project?: string;
};

async function permits({
  state,
  subject,
  action,
  application,
  resource = "applications",
  project = applicationProject(application, state === "on"),
}: PolicyQuery) {
  return argoRbacAllows({
    subject,
    action,
    resource,
    object: `${project}/${application}`,
    policyFile: policyFiles[state],
    kubeconfig,
    home: directory,
    builtinPolicy: false,
  });
}
type PolicyCase = {
  state: SwitchState;
  subject: string;
  action: string;
  application: string;
  resource: string;
  project: string;
  allowed: boolean;
};
/** The project a grant names; an unregistered name is probed in `default` when off. */
function projectOf(state: SwitchState, application: string): string {
  return application === "unregistered"
    ? ARGOCD_PROJECTS.root
    : applicationProject(application, state === "on");
}
function casesFor(state: SwitchState) {
  return (
    subject: string,
    applications: readonly string[],
    actions: readonly string[],
    allowed: boolean,
  ): PolicyCase[] =>
    applications.flatMap((application) =>
      actions.map((action) => ({
        state,
        subject,
        action,
        application,
        resource: "applications",
        project: projectOf(state, application),
        allowed,
      })),
    );
}
const offCases = casesFor("off");
const onCases = casesFor("on");
/** An unregistered name has no reviewed project, so prove denial in every project. */
function unregisteredCases(subject: string, actions: readonly string[]) {
  return Object.values(ARGOCD_PROJECTS).flatMap((project) =>
    actions.map((action) => ({
      state: "on" as const,
      subject,
      action,
      application: "unregistered",
      resource: "applications",
      project,
      allowed: false,
    })),
  );
}
const scale = "update/apps/Deployment/temporal/temporal-delivery-worker";
const writes = ["create", "update", "delete", "sync"];
/** Grants shared by both states: release-root and the control-plane barrier. */
function platformCases(state: SwitchState): PolicyCase[] {
  const stateCases = casesFor(state);
  return [
    ...stateCases(
      "delivery-platform",
      ["delivery-control-plane"],
      [scale],
      true,
    ),
    ...["delivery", "delivery-observer", "woodpecker"].flatMap((subject) =>
      stateCases(subject, ["delivery-control-plane"], [scale], false),
    ),
    ...stateCases(
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
    ...stateCases("delivery-platform", ["temporal"], [scale], false),
    ...stateCases(
      "delivery-platform",
      ["apps"],
      ["get", "update", "sync", "override"],
      true,
    ),
    ...stateCases(
      "delivery-platform",
      deliveryRootApplications(state === "on"),
      ["sync"],
      true,
    ),
    ...stateCases(
      "delivery-platform",
      ["delivery-control-plane"],
      ["get", "update", "sync"],
      true,
    ),
    ...stateCases(
      "delivery-platform",
      ["arcade", "scout-prod", "temporal", "storm-forum"],
      ["update", "sync", "override", "delete"],
      false,
    ),
    ...stateCases(
      "delivery-platform",
      ["delivery-control-plane"],
      ["override"],
      false,
    ),
    ...stateCases("delivery-platform", ["argocd"], ["update"], false),
    ...stateCases("woodpecker", ["apps"], ["sync"], false),
    {
      state,
      subject: "delivery-observer",
      application: "storm-forum",
      action: "get",
      resource: "logs",
      project: projectOf(state, "storm-forum"),
      allowed: false,
    },
    {
      state,
      subject: "delivery-observer",
      application: "storm-forum",
      action: "create",
      resource: "exec",
      project: projectOf(state, "storm-forum"),
      allowed: false,
    },
  ];
}
const permissions: PolicyCase[] = [
  // Off: exactly the pre-cutover grants, every Application in `default`.
  ...offCases(
    "delivery",
    DELIVERY_WORKLOAD_APPLICATIONS,
    ["get", "update", "sync"],
    true,
  ),
  ...offCases(
    "delivery",
    ["apps", "argocd", "delivery-control-plane", "unregistered"],
    ["sync", "update", "override", "delete"],
    false,
  ),
  ...offCases("delivery", DELIVERY_WORKLOAD_APPLICATIONS, ["create"], false),
  ...offCases(
    "delivery-observer",
    ["apps", "delivery-control-plane", ...DELIVERY_WORKLOAD_APPLICATIONS],
    ["get"],
    true,
  ),
  ...offCases(
    "delivery-observer",
    ["storm-forum"],
    ["update", "sync", "override", "delete"],
    false,
  ),
  ...offCases("delivery-observer", ["argocd"], ["get"], false),
  ...platformCases("off"),
  // On: Delivery owns every Application object in its reviewed project.
  ...onCases(
    "delivery",
    deliveryManagedApplications(true),
    ["get", ...writes],
    true,
  ),
  ...onCases("delivery", ["apps", "argocd"], ["get"], true),
  ...onCases("delivery", ["apps", "argocd"], [...writes, "override"], false),
  ...onCases("delivery", [...OPERATOR_RUN_DATA_APPLICATIONS], ["get"], true),
  ...onCases(
    "delivery",
    [...OPERATOR_RUN_DATA_APPLICATIONS],
    [...writes, "override"],
    false,
  ),
  ...onCases(
    "delivery",
    ["arcade", "delivery-control-plane", "temporal", "storm-forum"],
    ["override"],
    false,
  ),
  ...unregisteredCases("delivery", ["get", ...writes]),
  ...onCases(
    "delivery-observer",
    deliveryKnownApplications(true),
    ["get"],
    true,
  ),
  ...onCases(
    "delivery-observer",
    ["storm-forum", "argocd", "apps"],
    [...writes, "override"],
    false,
  ),
  ...unregisteredCases("delivery-observer", ["get"]),
  ...platformCases("on"),
];

test.each(permissions)(
  "$state: $subject $action $resource on $project/$application: allowed=$allowed",
  async ({
    state,
    subject,
    action,
    resource,
    application,
    project,
    allowed,
  }) => {
    expect(
      await permits({ state, subject, action, application, resource, project }),
    ).toBe(allowed);
  },
);

test.each(["off", "on"] as const)(
  "%s: every grant names the Application's reviewed project",
  (state) => {
    const rows = policyRows[state]
      .split("\n")
      .map((row) => row.trim())
      .filter((row) => row.startsWith("p, "))
      .map((row) => row.split(",").map((cell) => cell.trim()));
    expect(rows.length).toBeGreaterThan(100);
    for (const row of rows) {
      const [project, application] = z.string().parse(row[4]).split("/");
      expect(project, row.join(", ")).toBe(
        applicationProject(z.string().parse(application), state === "on"),
      );
    }
  },
);

test("the data layers exist for Delivery only under transition rendering", () => {
  for (const name of OPERATOR_RUN_DATA_APPLICATIONS) {
    expect(deliveryKnownApplications(false)).not.toContain(name);
    expect(deliveryKnownApplications(true)).toContain(name);
    expect(deliveryManagedApplications(true)).not.toContain(name);
  }
});

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
  registrations
    .filter(({ definition }) =>
      ["argocd", "control-plane"].includes(definition.kind),
    )
    .flatMap((registration) =>
      (["off", "on"] as const).map((state) => ({ ...registration, state })),
    ),
)(
  "$state: $file has its exact native update capability",
  async ({ definition, state }) => {
    const application = z.string().parse(definition.application);
    expect(
      await permits({
        state,
        subject:
          application === "delivery-control-plane"
            ? "delivery-platform"
            : "delivery",
        action: "update",
        application,
      }),
    ).toBe(true);
  },
);
