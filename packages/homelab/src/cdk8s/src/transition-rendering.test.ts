import { beforeAll, describe, expect, test, vi } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { setupCharts } from "./setup-charts.ts";
import type * as ReleaseConfiguration from "./release-configuration.ts";
import {
  APPLICATION_LIFECYCLE_ANNOTATION,
  APPLICATION_RESOURCES_FINALIZER,
  ARGOCD_SYNC_OPTIONS_ANNOTATION,
  MANAGED_APPLICATION_LABEL,
  ORPHAN_ROOT_ANNOTATION,
} from "./application-release-policy.ts";
import {
  BASELINE_CHART_APPLICATIONS,
  CLUSTER_ADMISSION_CHART,
  CLUSTER_PLATFORM_CHART,
  ROOT_CHART,
} from "./resources/cluster-baseline/charts.ts";
import { APPLICATION_SOURCE_POLICY } from "./resources/argocd-application-admission.ts";
import { deliveryArgoPolicy } from "./resources/argo-applications/platform/delivery-rbac.ts";
import { ARGOCD_PROJECTS } from "./resources/argo-applications/platform/projects.ts";
import {
  DELIVERY_API_SERVICE_ACCOUNT,
  DELIVERY_KUBERNETES_READERS,
} from "@shepherdjerred/ops-model/delivery-readers.ts";
import {
  MC_SANDBOX_LOCAL_QUEUE,
  MC_SANDBOX_QUALIFICATION_QUOTA,
} from "./resources/mc-sandbox/limits.ts";
import { MC_SANDBOX_STORM_IMAGE_PARAMETERS } from "./resources/mc-sandbox/image-parameters.ts";
import { MC_SANDBOX_POD_GUARD_POLICY } from "./resources/mc-sandbox/pod-guard.ts";
import { CI_CLUSTER_QUEUE } from "./resources/kueue-config.ts";
import { KUEUE_MANAGED_NAMESPACE_LABEL } from "./resources/woodpecker/ci-namespace.ts";
import { CATALOG_CORE } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { catalogEnvironmentOf } from "@shepherdjerred/ops-model/delivery-catalog/migration.ts";
import { RecipeDefinitionSchema } from "@shepherdjerred/delivery/model-contract";
import { recipeApplications } from "./catalog/catalog-applications.ts";
import {
  DELIVERY_ACTIVE_DELEGATIONS,
  DELIVERY_ENVIRONMENT_ANNOTATION,
  TRANSITION_ROOT_IGNORE_EXPRESSIONS,
} from "homelab/src/delivery-ownership.ts";

/**
 * The cutover window turns transition rendering on with a one-line change.
 * This renders every chart in that state, so the change the window merges is
 * the change these assertions prove.
 */
vi.mock("./release-configuration.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof ReleaseConfiguration>()),
  transitionRendering: () => true,
}));

const ManifestSchema = z.looseObject({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.looseObject({
    name: z.string(),
    namespace: z.string().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    annotations: z.record(z.string(), z.string()).optional(),
    finalizers: z.array(z.string()).optional(),
  }),
  spec: z.unknown().optional(),
});
type Manifest = z.infer<typeof ManifestSchema>;

let charts: Map<string, Manifest[]>;
beforeAll(async () => {
  const app = new App({ outdir: ".test-synth-transition" });
  await setupCharts(app);
  charts = new Map(
    app.charts.map((chart) => [
      chart.node.id,
      z.array(ManifestSchema).parse(chart.toJson()),
    ]),
  );
});

function chartObjects(id: string): Manifest[] {
  const objects = charts.get(id);
  if (objects === undefined) throw new Error(`Chart ${id} was not rendered`);
  return objects;
}

function find(id: string, kind: string, name: string): Manifest {
  const found = chartObjects(id).find(
    (manifest) => manifest.kind === kind && manifest.metadata.name === name,
  );
  if (found === undefined) throw new Error(`${id} renders no ${kind}/${name}`);
  return found;
}

function names(id: string, kind: string): string[] {
  return chartObjects(id)
    .filter((manifest) => manifest.kind === kind)
    .map((manifest) => manifest.metadata.name);
}

describe("transition rendering", () => {
  test("retains every root child with Prune=false and no resources finalizer", () => {
    const children = chartObjects(ROOT_CHART).filter(
      (manifest) =>
        manifest.kind === "Application" &&
        !["apps", "argocd"].includes(manifest.metadata.name),
    );
    expect(children.length).toBeGreaterThan(50);
    for (const child of children) {
      const { metadata } = child;
      expect(metadata.annotations?.[APPLICATION_LIFECYCLE_ANNOTATION]).toBe(
        "retain",
      );
      expect(
        metadata.annotations?.[ARGOCD_SYNC_OPTIONS_ANNOTATION]?.split(","),
        metadata.name,
      ).toContain("Prune=false");
      expect(metadata.finalizers ?? []).not.toContain(
        APPLICATION_RESOURCES_FINALIZER,
      );
      expect(metadata.labels?.[MANAGED_APPLICATION_LABEL]).toBe("true");
    }
  });

  test("renders the operator-run data-layer Applications in the cluster project, without automated sync", () => {
    for (const name of ["delivery-data", "temporal-data"]) {
      const application = z
        .object({
          spec: z.looseObject({
            project: z.string(),
            syncPolicy: z.looseObject({}).optional(),
          }),
        })
        .parse(find(ROOT_CHART, "Application", name));
      expect(application.spec.project).toBe(ARGOCD_PROJECTS.cluster);
      expect(application.spec.syncPolicy ?? {}).not.toHaveProperty("automated");
    }
  });

  test("moves the database objects and Namespaces to the data-layer charts", () => {
    const dataKinds = new Set(["postgresql", "Certificate", "Issuer"]);
    for (const [application, data] of [
      ["delivery", "delivery-data"],
      ["temporal", "temporal-data"],
    ] as const) {
      expect(
        chartObjects(application)
          .filter(
            (manifest) =>
              dataKinds.has(manifest.kind) ||
              (manifest.kind === "Namespace" &&
                manifest.metadata.name === application) ||
              manifest.metadata.name === "temporal-postgresql-netpol",
          )
          .map((manifest) => `${manifest.kind}/${manifest.metadata.name}`),
      ).toEqual([]);
      expect(names(data, "Namespace")).toEqual([application]);
      expect(names(data, "postgresql")).toEqual([`${application}-postgresql`]);
    }
  });

  test("admits only Delivery's source writes and the orphaned root's deletion", () => {
    for (const id of [ROOT_CHART, CLUSTER_ADMISSION_CHART]) {
      expect(names(id, "ValidatingAdmissionPolicy")).toContain(
        APPLICATION_SOURCE_POLICY,
      );
      expect(names(id, "ValidatingAdmissionPolicyBinding")).toContain(
        APPLICATION_SOURCE_POLICY,
      );
      expect(
        JSON.stringify(
          find(
            id,
            "ValidatingAdmissionPolicy",
            "argocd-application-lifecycle.sjer.red",
          ).spec,
        ),
      ).toContain(ORPHAN_ROOT_ANNOTATION);
    }
  });

  test("keeps every baseline chart a byte-identical mirror of the root", () => {
    const root = new Map(
      chartObjects(ROOT_CHART).map((manifest) => [
        `${manifest.apiVersion}/${manifest.kind}/${manifest.metadata.namespace ?? "-"}/${manifest.metadata.name}`,
        manifest,
      ]),
    );
    for (const id of BASELINE_CHART_APPLICATIONS)
      for (const manifest of chartObjects(id)) {
        const key = `${manifest.apiVersion}/${manifest.kind}/${manifest.metadata.namespace ?? "-"}/${manifest.metadata.name}`;
        expect(manifest, key).toStrictEqual(root.get(key));
      }
  });

  test("splits the AppProjects and grants Delivery its full Application lifecycle", () => {
    expect(names(ROOT_CHART, "AppProject").sort()).toEqual(
      Object.values(ARGOCD_PROJECTS).sort(),
    );
    expect(
      JSON.stringify(find(ROOT_CHART, "Application", "argocd").spec),
    ).toContain(JSON.stringify(deliveryArgoPolicy(true)));
  });

  test("queues mc-sandbox through the CI node's ClusterQueue with its qualification quota", () => {
    expect(
      find("mc-sandbox", "Namespace", "mc-sandbox").metadata.labels?.[
        KUEUE_MANAGED_NAMESPACE_LABEL
      ],
    ).toBe("true");
    expect(
      find("mc-sandbox", "LocalQueue", MC_SANDBOX_LOCAL_QUEUE),
    ).toMatchObject({
      metadata: { namespace: "mc-sandbox" },
      spec: { clusterQueue: CI_CLUSTER_QUEUE },
    });
    expect(
      find("mc-sandbox", "ResourceQuota", "mc-sandbox-quota").spec,
    ).toEqual({ hard: MC_SANDBOX_QUALIFICATION_QUOTA });
    for (const id of [ROOT_CHART, CLUSTER_PLATFORM_CHART])
      expect(
        JSON.stringify(find(id, "ClusterQueue", CI_CLUSTER_QUEUE).spec),
      ).toContain('"mc-sandbox"');
  });

  test("reads the Storm images allowed in mc-sandbox from the deployment", () => {
    const guard = JSON.stringify(
      find(
        "mc-sandbox",
        "ValidatingAdmissionPolicy",
        MC_SANDBOX_POD_GUARD_POLICY,
      ).spec,
    );
    for (const parameter of MC_SANDBOX_STORM_IMAGE_PARAMETERS)
      expect(guard).toContain(`Delivery requires image:${parameter}`);
    expect(guard).not.toContain("the-storm-server@sha256:");
  });

  test("loads the Delivery monitor alarm and labels Scout's interrupted attempts by environment", () => {
    expect(
      JSON.stringify(
        chartObjects("delivery").filter(
          (manifest) => manifest.kind === "PrometheusRule",
        ),
      ),
    ).toContain('"alert":"DeliveryMonitorAlarmed"');
    const scout = JSON.stringify(
      chartObjects(ROOT_CHART).filter(
        (manifest) => manifest.kind === "PrometheusRule",
      ),
    );
    expect(scout).toContain(
      "sum by (environment, kind) (increase(scout_temporal_interrupted_provider_attempts_total[30m])) > 0",
    );
  });
});

describe("transition rendering: Delivery's Application reader", () => {
  const reader = DELIVERY_KUBERNETES_READERS.application;
  test("is declared once, as a read-only Role bound to the Delivery API's own account", () => {
    const delivery = chartObjects("delivery");
    expect(
      delivery
        .filter((manifest) => manifest.metadata.name === reader.name)
        .map(
          (manifest) => `${manifest.kind}/${manifest.metadata.namespace ?? ""}`,
        ),
    ).toEqual(["Role/argocd", "RoleBinding/argocd"]);
    expect(find("delivery", "Role", reader.name)).toMatchObject({
      rules: [
        {
          apiGroups: ["argoproj.io"],
          resources: ["applications"],
          verbs: ["get", "list", "watch"],
        },
      ],
    });
    expect(find("delivery", "RoleBinding", reader.name)).toMatchObject({
      roleRef: { kind: "Role", name: reader.name },
      subjects: [{ kind: "ServiceAccount", ...DELIVERY_API_SERVICE_ACCOUNT }],
    });
  });

  test("projects one short-lived token of the API's account at the reader directory", () => {
    const pod = z
      .object({
        spec: z.object({
          template: z.object({
            spec: z.looseObject({
              serviceAccountName: z.string(),
              volumes: z.array(z.looseObject({ name: z.string() })),
              containers: z.array(
                z.looseObject({
                  name: z.string(),
                  volumeMounts: z.array(
                    z.looseObject({ name: z.string(), mountPath: z.string() }),
                  ),
                }),
              ),
            }),
          }),
        }),
      })
      .parse(find("delivery", "Deployment", "delivery")).spec.template.spec;
    expect(pod.serviceAccountName).toBe(DELIVERY_API_SERVICE_ACCOUNT.name);
    const mounts = pod.containers.flatMap((container) =>
      container.volumeMounts.filter(
        (mount) => mount.mountPath === reader.directory,
      ),
    );
    expect(mounts).toEqual([
      { name: reader.name, mountPath: reader.directory, readOnly: true },
    ]);
    expect(
      pod.volumes.find((volume) => volume.name === reader.name),
    ).toMatchObject({
      projected: {
        sources: [
          { serviceAccountToken: { path: "token", expirationSeconds: 600 } },
          {
            configMap: {
              name: "kube-root-ca.crt",
              items: [{ key: "ca.crt", path: "ca.crt" }],
            },
          },
        ],
      },
    });
    expect(names("delivery", "Secret")).not.toContain(`${reader.name}-token`);
    expect(names("delivery", "ServiceAccount")).not.toContain(reader.name);
  });
});

describe("transition rendering: v2 environment ownership", () => {
  const REGISTRATIONS = new URL(
    "../../../../delivery/registrations/v2/",
    import.meta.url,
  );

  test("every catalog Application environment's root child carries its environment", async () => {
    const children = new Map(
      chartObjects(ROOT_CHART)
        .filter((manifest) => manifest.kind === "Application")
        .map((manifest) => [manifest.metadata.name, manifest]),
    );
    let stamped = 0;
    for (const environment of CATALOG_CORE.environments) {
      const recipe = z
        .object({ definition: RecipeDefinitionSchema })
        .parse(
          await Bun.file(
            new URL(`${environment.id}/recipe.json`, REGISTRATIONS),
          ).json(),
        );
      for (const name of recipeApplications(recipe.definition)) {
        // Companion Applications are Delivery's; the root never renders them.
        const child = children.get(name);
        if (child === undefined) continue;
        const annotation =
          child.metadata.annotations?.[DELIVERY_ENVIRONMENT_ANNOTATION];
        expect(annotation, name).toBeDefined();
        // v1's two renamed delegations keep their v1 id until the window's
        // migration carries them to the catalog environment.
        expect(catalogEnvironmentOf(annotation ?? ""), name).toBe(
          environment.id,
        );
        if (DELIVERY_ACTIVE_DELEGATIONS[name] === undefined)
          expect(annotation, name).toBe(environment.id);
        stamped += 1;
      }
    }
    expect(stamped).toBeGreaterThan(60);
  });

  test("the root preserves only v1's delegated fields", () => {
    const root = z
      .object({
        spec: z.looseObject({
          ignoreDifferences: z.array(
            z.looseObject({
              kind: z.string(),
              jqPathExpressions: z.array(z.string()).optional(),
            }),
          ),
        }),
      })
      .parse(find(ROOT_CHART, "Application", "apps"));
    expect(
      root.spec.ignoreDifferences.find((rule) => rule.kind === "Application")
        ?.jqPathExpressions,
    ).toEqual(TRANSITION_ROOT_IGNORE_EXPRESSIONS);
  });
});
