import { describe, expect, it } from "vitest";
import {
  DeploymentDetailSchema,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { RecipeDefinitionSchema } from "@shepherdjerred/delivery/model-contract";
import type { ManagedResource } from "homelab/scripts/argocd/argocd-apply-safety.ts";
import { renderApplication } from "#lib/delivery/model/application.ts";
import { definition, temporal } from "./model-worker-fixture.ts";
import { retiredCentralWorkers } from "./worker-pool-fixture.ts";
import { workerSyncPrunes } from "./worker-prune.ts";

const [retired] = retiredCentralWorkers(1);
if (retired === undefined) throw new Error("No retired fixture host");
const track = `delivery-wf-retained-${retired.buildId.slice(0, 12)}`;

function withRetired(): DeploymentDetail {
  const current = temporal([]);
  const pool = current.deployment.workerSnapshot;
  if (pool === null) throw new Error("The fixture has no worker pool");
  return DeploymentDetailSchema.parse({
    ...current,
    deployment: {
      ...current.deployment,
      workerSnapshot: { ...pool, versions: [...pool.versions, retired] },
    },
  });
}

function rendered(detail: DeploymentDetail) {
  const recipe = RecipeDefinitionSchema.parse(definition);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("temporal is a Kubernetes application recipe");
  return renderApplication(detail, recipe);
}

type Live = {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    annotations: Record<string, string>;
  };
};

function apiGroup(apiVersion: string) {
  return apiVersion.includes("/")
    ? apiVersion.slice(0, apiVersion.indexOf("/"))
    : "";
}

/** One live object Argo tracks for the temporal Application. */
function object(
  apiVersion: string,
  kind: string,
  name: string,
  extra: Record<string, unknown> = {},
): Live {
  return {
    apiVersion,
    kind,
    metadata: {
      name,
      namespace: "temporal",
      uid: `uid/${kind}/${name}`,
      annotations: {
        "argocd.argoproj.io/tracking-id": `temporal:${apiGroup(apiVersion)}/${kind}:temporal/${name}`,
      },
    },
    ...extra,
  };
}

function retiredHost(replicas = 0, build = retired?.buildId ?? "") {
  return [
    object("apps/v1", "Deployment", `temporal-${track}`, {
      spec: {
        replicas,
        template: {
          metadata: {
            labels: { "delivery.shepherdjerred.com/worker-build": build },
          },
        },
      },
      status: {},
    }),
    object("v1", "ServiceAccount", track),
    object("v1", "Service", `${track}-app-metrics`),
    object(
      "monitoring.coreos.com/v1",
      "ServiceMonitor",
      `${track}-app-metrics-service-monitor`,
    ),
  ];
}

function argo(detail: DeploymentDetail, live: Live[]) {
  const application = rendered(detail);
  const app = {
    metadata: {
      name: "temporal",
      uid: "app-uid",
      annotations: {
        "delivery.shepherdjerred.com/environment": "temporal/prod",
      },
    },
    spec: { source: structuredClone(application.source) },
    status: { operationState: { phase: "Succeeded", operation: { info: [] } } },
  };
  const kept = object("v1", "ConfigMap", "temporal-config");
  const managed: ManagedResource[] = [kept, ...live].map((resource) => ({
    ...(apiGroup(resource.apiVersion) === ""
      ? {}
      : { group: apiGroup(resource.apiVersion) }),
    kind: resource.kind,
    name: resource.metadata.name,
    namespace: "temporal",
    liveState: JSON.stringify(resource),
    targetState: resource === kept ? JSON.stringify(kept) : "null",
  }));
  const paths: string[] = [];
  const read = async (path: string): Promise<unknown> => {
    paths.push(path);
    if (path === "temporal?refresh=hard" || path === "temporal") return app;
    if (path.startsWith("temporal/manifests?"))
      return { manifests: [JSON.stringify(kept)] };
    if (path === "temporal/managed-resources") return { items: managed };
    if (path.startsWith("temporal/resource?")) {
      const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
      const found = live.find(
        (resource) =>
          resource.metadata.name === query.get("resourceName") &&
          resource.kind === query.get("kind"),
      );
      if (found === undefined) throw new Error(`Unexpected resource ${path}`);
      return { manifest: JSON.stringify(found) };
    }
    throw new Error(`Unexpected read ${path}`);
  };
  return { application, app, read, paths };
}

describe("worker sync pruning", () => {
  it("prunes exactly the objects of a host an earlier retirement scaled to zero", async () => {
    const detail = withRetired();
    const { application, read, paths } = argo(detail, retiredHost());
    expect(await workerSyncPrunes(detail, application, read)).toBe(true);
    expect(paths.filter((path) => path.includes("/resource?"))).toHaveLength(4);
  });

  it("does not prune when there is nothing obsolete", async () => {
    const detail = withRetired();
    const { application, read } = argo(detail, []);
    expect(await workerSyncPrunes(detail, application, read)).toBe(false);
  });

  it("does not consult Argo without a retired host or for another Application", async () => {
    const detail = temporal([]);
    const reads: string[] = [];
    const read = async (path: string): Promise<unknown> => {
      reads.push(path);
      await Promise.resolve();
      throw new Error("unexpected read");
    };
    expect(await workerSyncPrunes(detail, rendered(detail), read)).toBe(false);
    const retiredDetail = withRetired();
    expect(
      await workerSyncPrunes(
        retiredDetail,
        { ...rendered(retiredDetail), name: "scout-beta" },
        read,
      ),
    ).toBe(false);
    expect(reads).toEqual([]);
  });

  it("leaves the sync unpruned when another object is obsolete", async () => {
    const detail = withRetired();
    const { application, read } = argo(detail, [
      ...retiredHost(),
      object("v1", "ConfigMap", "temporal-removed-config"),
    ]);
    expect(await workerSyncPrunes(detail, application, read)).toBe(false);
  });

  it("leaves a live host's objects alone", async () => {
    const detail = withRetired();
    const live = object(
      "v1",
      "Service",
      `delivery-wf-retained-${"a".repeat(12)}-app-metrics`,
    );
    const { application, read } = argo(detail, [...retiredHost(), live]);
    expect(await workerSyncPrunes(detail, application, read)).toBe(false);
  });

  it("refuses a retired host whose Deployment still runs or serves another build", async () => {
    const detail = withRetired();
    for (const host of [retiredHost(1), retiredHost(0, "f".repeat(40))]) {
      const { application, read } = argo(detail, host);
      await expect(workerSyncPrunes(detail, application, read)).rejects.toThrow(
        /not its build's Deployment at zero replicas/u,
      );
    }
  });

  it("refuses an object Argo does not track for this Application", async () => {
    const detail = withRetired();
    const host = retiredHost();
    const [deployment] = host;
    if (deployment === undefined) throw new Error("No fixture Deployment");
    deployment.metadata.annotations["argocd.argoproj.io/tracking-id"] =
      "scout-beta:apps/Deployment:temporal/other";
    const { application, read } = argo(detail, host);
    await expect(workerSyncPrunes(detail, application, read)).rejects.toThrow(
      /is not the exact owned resource/u,
    );
  });

  it("refuses when the Application changed during inspection", async () => {
    const detail = withRetired();
    const { application, app, read } = argo(detail, retiredHost());
    // Only the final readback reads the plain path; the first one refreshes.
    const changing = async (path: string) =>
      path === "temporal"
        ? { ...app, metadata: { ...app.metadata, uid: "replaced" } }
        : await read(path);
    await expect(
      workerSyncPrunes(detail, application, changing),
    ).rejects.toThrow(/changed before its pruning sync/u);
  });
});
