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
  deliveryArgoAccounts,
  deliveryArgoPolicy,
  deliveryKnownApplications,
  deliveryManagedApplications,
  deliveryRootApplications,
  OPERATOR_RUN_APPLICATIONS,
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
  // The rendered chart carries the committed switch state: the operator
  // tool's account exists only under transition rendering.
  expect(cm["accounts.operator-run"]).toBe(
    transitionRendering() ? "apiKey" : undefined,
  );
  expect(deliveryArgoAccounts(false)).not.toHaveProperty(
    "accounts.operator-run",
  );
  expect(deliveryArgoAccounts(true)).toMatchObject({
    "accounts.operator-run": "apiKey",
    "accounts.operator-run.enabled": true,
  });
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
  // ArgoCD is a self-hosted service Delivery deploys (model D8); only the
  // retained root stays read-only.
  ...onCases("delivery", ["argocd"], ["get", ...writes], true),
  ...onCases("delivery", ["apps"], ["get"], true),
  ...onCases("delivery", ["apps"], [...writes, "override"], false),
  ...onCases("delivery", [...OPERATOR_RUN_DATA_APPLICATIONS], ["get"], true),
  ...onCases(
    "delivery",
    [...OPERATOR_RUN_DATA_APPLICATIONS],
    [...writes, "override"],
    false,
  ),
  ...onCases(
    "delivery",
    ["arcade", "argocd", "delivery-control-plane", "temporal", "storm-forum"],
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
  // The operator tool's account applies and syncs exactly the operator-run
  // Applications, after the window only.
  ...onCases(
    "operator-run",
    [...OPERATOR_RUN_APPLICATIONS],
    ["get", "update", "sync"],
    true,
  ),
  ...onCases(
    "operator-run",
    [...OPERATOR_RUN_APPLICATIONS],
    ["create", "delete", "override"],
    false,
  ),
  ...onCases(
    "operator-run",
    ["argocd", "arcade", "cluster-platform"],
    ["get", "update", "sync"],
    false,
  ),
  ...offCases("operator-run", ["arcade", "argocd"], ["get", "sync"], false),
  // The operator tool's grant moves no effect onto Delivery's accounts:
  // Delivery's executor only reads the operator-run Applications, and
  // release-root keeps only its read and its sync of root-owned children.
  ...onCases(
    "delivery",
    [...OPERATOR_RUN_APPLICATIONS],
    ["update", "sync", "delete", "override"],
    false,
  ),
  ...onCases(
    "delivery-platform",
    [...OPERATOR_RUN_APPLICATIONS],
    ["update", "delete", "override"],
    false,
  ),
  ...platformCases("on"),
  // Window step 3b: before the window, release-root may already read every
  // child and sync each root-owned one in its transition project, so the
  // final v1 root release (step 4b) keeps access after it moves them and
  // before `argocd` syncs the transition policy. No other account gains it.
  ...deliveryKnownApplications(true).flatMap((application) => {
    const project = applicationProject(application, true);
    const offCase = (subject: string, action: string, allowed: boolean) => ({
      state: "off" as const,
      subject,
      action,
      application,
      resource: "applications",
      project,
      allowed,
    });
    return [
      offCase("delivery-platform", "get", true),
      offCase(
        "delivery-platform",
        "sync",
        deliveryRootApplications(true).includes(application) ||
          application === "apps" ||
          application === "delivery-control-plane",
      ),
      offCase("delivery-platform", "delete", false),
      ...(project === ARGOCD_PROJECTS.root
        ? []
        : [offCase("delivery", "sync", false)]),
    ];
  }),
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
      const [project, name] = z.string().parse(row[4]).split("/");
      const application = z.string().parse(name);
      const reviewed = [applicationProject(application, state === "on")];
      // Off, release-root also holds its rows in the transition projects
      // (window step 3b), so the final v1 root release keeps its access.
      if (state === "off" && row[1] === "delivery-platform")
        reviewed.push(applicationProject(application, true));
      expect(reviewed, row.join(", ")).toContain(project);
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
  // Shared-site and root registrations are retired (X4, X6); their
  // successors come from the catalog document.
  expect(registrationFiles).toHaveLength(18);
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

test("under transition rendering Delivery creates the baseline and companion Applications, and only reads the operator-run ones", () => {
  const rows = deliveryArgoPolicy(true).split("\n");
  const actions = (application: string) =>
    rows
      .filter(
        (row) =>
          row.startsWith("p, delivery, ") &&
          row.endsWith(`/${application}, allow`),
      )
      .map((row) => row.split(", ")[3])
      .toSorted((left = "", right = "") => left.localeCompare(right));
  const full = ["create", "delete", "get", "sync", "update"];
  for (const application of [
    "cluster-platform",
    "cluster-observability",
    "argocd-companion",
    "velero-companion",
    "velero-schedules",
  ])
    expect(actions(application), application).toEqual(full);
  for (const application of [
    "cluster-admission",
    "delivery-data",
    "temporal-data",
  ])
    expect(actions(application), application).toEqual(["get"]);
  // Off, only release-root's window rows (step 3b) name a catalog-only
  // Application; Delivery's own account has none.
  expect(
    deliveryArgoPolicy(false)
      .split("\n")
      .filter(
        (row) =>
          row.includes("/cluster-platform,") &&
          !row.startsWith("p, delivery-platform, "),
      ),
  ).toEqual([]);
});
