import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import { createDeliveryChart } from "./delivery.ts";
import { createDeliveryDataChart } from "./delivery-data.ts";
import { createTemporalChart } from "./temporal.ts";
import { createTemporalDataChart } from "./temporal-data.ts";
import { deliveryActivation } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/activation.ts";
import { createSingleAppPostgreSQL } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/single-app-postgresql.ts";
import { createTemporalPostgreSQLDatabase } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db.ts";
import {
  ARGOCD_SYNC_OPTIONS_ANNOTATION,
  RETAINED_RESOURCE_SYNC_OPTIONS,
} from "@shepherdjerred/homelab/cdk8s/src/misc/argocd-sync-options.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import { applyApplicationReleasePolicy } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { createDeliveryDataApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/delivery-data.ts";
import { createTemporalDataApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/temporal-data.ts";
import { ROOT_CHART } from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/charts.ts";

const ResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z
      .object({
        name: z.string(),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .loose(),
    spec: z.unknown().optional(),
  })
  .loose();
type Resource = z.infer<typeof ResourceSchema>;

function render(outdir: string, create: (app: App) => unknown): Resource[] {
  const app = new App({ outdir });
  create(app);
  return app.charts.flatMap((chart) =>
    z.array(ResourceSchema).parse(chart.toJson()),
  );
}

function inventory(resources: readonly Resource[]): [string, string][] {
  return resources.map((resource) => [resource.kind, resource.metadata.name]);
}

function find(resources: readonly Resource[], kind: string, name: string) {
  const resource = resources.find(
    (candidate) => candidate.kind === kind && candidate.metadata.name === name,
  );
  if (resource === undefined) throw new Error(`Missing ${kind}/${name}`);
  return resource;
}

/** The cluster exactly as the application charts rendered it before the split. */
function clusterAsReleasedToday(
  chartId: string,
  namespace: string,
  create: (chart: Chart) => { toJson: () => unknown },
): Resource {
  const chart = new Chart(new App(), chartId, {
    namespace,
    disableResourceNameHashes: true,
  });
  return ResourceSchema.parse(create(chart).toJson());
}

function retained(resource: Resource): Resource {
  return {
    ...resource,
    metadata: {
      ...resource.metadata,
      annotations: {
        ...resource.metadata.annotations,
        [ARGOCD_SYNC_OPTIONS_ANNOTATION]: RETAINED_RESOURCE_SYNC_OPTIONS,
      },
    },
  };
}

const deliveryData = render(
  ".test-synth-delivery-data",
  createDeliveryDataChart,
);
const temporalData = render(
  ".test-synth-temporal-data",
  createTemporalDataChart,
);
const deliveryApp = render(".test-synth-delivery-app", (app) => {
  createDeliveryChart(app, deliveryActivation());
});
const temporalApp = render(".test-synth-temporal-app", createTemporalChart);

describe("PostgreSQL data-layer charts", () => {
  test("render exactly the data-layer objects", () => {
    expect(inventory(deliveryData)).toEqual([
      ["Namespace", "delivery"],
      ["postgresql", "delivery-postgresql"],
    ]);
    expect(inventory(temporalData)).toEqual([
      ["Namespace", "temporal"],
      ["Issuer", "temporal-postgresql-self-signed"],
      ["Certificate", "temporal-postgresql-ca"],
      ["Issuer", "temporal-postgresql-ca-issuer"],
      ["Certificate", "temporal-postgresql"],
      ["postgresql", "temporal-postgresql"],
      ["NetworkPolicy", "temporal-postgresql-netpol"],
    ]);
  });

  // Adoption must be a no-op for the live clusters: the data charts emit the
  // same constructors' output, plus only the prune protection.
  test("adopt the clusters byte-identically apart from prune protection", () => {
    expect(find(deliveryData, "postgresql", "delivery-postgresql")).toEqual(
      retained(
        clusterAsReleasedToday("delivery", "delivery", (chart) => {
          return createSingleAppPostgreSQL(chart, {
            app: "delivery",
            userFlags: [],
          });
        }),
      ),
    );
    expect(find(temporalData, "postgresql", "temporal-postgresql")).toEqual(
      retained(
        clusterAsReleasedToday("temporal", "temporal", (chart) =>
          createTemporalPostgreSQLDatabase(chart),
        ),
      ),
    );
  });

  test("keep Delete=false and add Prune=false on every cluster", () => {
    for (const resource of [...deliveryData, ...temporalData]) {
      if (resource.kind !== "postgresql") continue;
      expect(
        resource.metadata.annotations?.[ARGOCD_SYNC_OPTIONS_ANNOTATION],
      ).toBe("Prune=false,Delete=false");
    }
  });

  // The data chart owns its Namespace under transition rendering; adopting it
  // changes nothing but the added retention.
  test.runIf(!transitionRendering())(
    "own the Namespace exactly as the application chart renders it, retained",
    () => {
      for (const [app, data, namespace] of [
        [deliveryApp, deliveryData, "delivery"],
        [temporalApp, temporalData, "temporal"],
      ] as const) {
        const rendered = find(data, "Namespace", namespace);
        expect(rendered).toEqual(retained(find(app, "Namespace", namespace)));
        expect(
          rendered.metadata.annotations?.[ARGOCD_SYNC_OPTIONS_ANNOTATION],
        ).toBe(RETAINED_RESOURCE_SYNC_OPTIONS);
      }
    },
  );

  // Until the switch is on, the application charts keep every object the
  // data charts will adopt, so nothing the running system deploys changes.
  test.runIf(!transitionRendering())(
    "leave the application charts unchanged while transition rendering is off",
    () => {
      for (const [app, data] of [
        [deliveryApp, deliveryData],
        [temporalApp, temporalData],
      ] as const) {
        const keys = new Set(
          inventory(app).map(([kind, name]) => `${kind}/${name}`),
        );
        for (const [kind, name] of inventory(data))
          expect(keys.has(`${kind}/${name}`), `${kind}/${name}`).toBe(true);
        for (const resource of data) {
          if (resource.kind === "Namespace") continue;
          const original = find(app, resource.kind, resource.metadata.name);
          expect(resource).toEqual(
            resource.kind === "postgresql" ? retained(original) : original,
          );
        }
      }
    },
  );
});

// Under transition rendering the application charts render none of the
// objects the data charts own; `transition-rendering.test.ts` proves it for
// the whole app.
test.runIf(transitionRendering())(
  "own the Namespace the application charts no longer render",
  () => {
    for (const [app, data, namespace] of [
      [deliveryApp, deliveryData, "delivery"],
      [temporalApp, temporalData, "temporal"],
    ] as const) {
      expect(
        app.some(
          (resource) =>
            resource.kind === "Namespace" &&
            resource.metadata.name === namespace,
        ),
      ).toBe(false);
      expect(
        find(data, "Namespace", namespace).metadata.annotations?.[
          ARGOCD_SYNC_OPTIONS_ANNOTATION
        ],
      ).toBe(RETAINED_RESOURCE_SYNC_OPTIONS);
    }
  },
);

describe("Operator-run data-layer Applications", () => {
  // Restoring a database from a Velero backup deletes its `postgresql`
  // object. An automated sync would recreate an empty cluster over the volume
  // being restored, so only the guarded release syncs these Applications.
  test.each([false, true])(
    "never sync automatically (transition rendering %s)",
    (transition) => {
      const app = new App({
        outdir: `.test-synth-data-apps-${String(transition)}`,
      });
      const chart = new Chart(app, ROOT_CHART, {
        namespace: "argocd",
        disableResourceNameHashes: true,
      });
      createDeliveryDataApp(chart);
      createTemporalDataApp(chart);
      applyApplicationReleasePolicy(app, transition);
      const applications = z
        .array(
          z.looseObject({
            kind: z.literal("Application"),
            metadata: z.looseObject({ name: z.string() }),
            spec: z.looseObject({
              syncPolicy: z.looseObject({}).optional(),
            }),
          }),
        )
        .parse(chart.toJson());
      expect(
        applications.map((application) => application.metadata.name),
      ).toEqual(["delivery-data", "temporal-data"]);
      for (const application of applications)
        expect(application.spec.syncPolicy ?? {}).not.toHaveProperty(
          "automated",
        );
    },
  );
});
