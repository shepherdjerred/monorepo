import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import {
  ORDINARY_DELIVERY_ENVIRONMENTS,
  SPECIALIZED_DELIVERY_ENVIRONMENTS,
  applicationReleasePolicy,
} from "homelab/src/delivery-target-policy.ts";
import { applicationProject } from "./projects.ts";
import { transitionRendering } from "homelab/src/cdk8s/src/release-configuration.ts";

export const DELIVERY_ARGO_ACCOUNTS = {
  "accounts.delivery": "apiKey",
  "accounts.delivery.enabled": true,
  "accounts.delivery-observer": "apiKey",
  "accounts.delivery-observer.enabled": true,
  "accounts.delivery-platform": "apiKey",
  "accounts.delivery-platform.enabled": true,
} as const;
export const DELIVERY_ARGO_SERVER_SETTINGS = {
  "server.rbac.disableApplicationFineGrainedRBACInheritance": true,
} as const;

export const DELIVERY_WORKLOAD_APPLICATIONS = Object.keys({
  ...ORDINARY_DELIVERY_ENVIRONMENTS,
  ...SPECIALIZED_DELIVERY_ENVIRONMENTS,
})
  .filter((name) => name !== "delivery-control-plane")
  .sort();
/**
 * Operator-run data layers (model section 7): their Applications exist only
 * under transition rendering, and Delivery records their deployments but
 * never writes them; `release-root` and the operator release them.
 */
export const OPERATOR_RUN_DATA_APPLICATIONS: ReadonlySet<string> = new Set([
  "delivery-data",
  "temporal-data",
]);
const CATALOG_APPLICATIONS = [
  ...new Set([
    "apps",
    "delivery-control-plane",
    ...DELIVERY_WORKLOAD_APPLICATIONS,
    ...SERVICE_CATALOG.services.flatMap((service) => service.argoApps),
  ]),
].sort();
/** Every Application the rendered root and Delivery know, by switch state. */
export function deliveryKnownApplications(
  transition: boolean = transitionRendering(),
): string[] {
  return transition
    ? CATALOG_APPLICATIONS
    : CATALOG_APPLICATIONS.filter(
        (name) => !OPERATOR_RUN_DATA_APPLICATIONS.has(name),
      );
}
export const DELIVERY_KNOWN_APPLICATIONS = deliveryKnownApplications();
export function deliveryRootApplications(
  transition: boolean = transitionRendering(),
): string[] {
  return deliveryKnownApplications(transition).filter(
    (name) =>
      name !== "apps" &&
      applicationReleasePolicy(name).owner === "release-root",
  );
}
export const DELIVERY_ROOT_APPLICATIONS = deliveryRootApplications();
/** The retained root and ArgoCD itself stay read-only for Delivery. */
const RETAINED_APPLICATIONS = new Set(["apps", "argocd"]);
/** Under transition rendering Delivery creates, updates, deletes and syncs every other Application. */
export function deliveryManagedApplications(
  transition: boolean = transitionRendering(),
): string[] {
  return deliveryKnownApplications(transition).filter(
    (name) =>
      !RETAINED_APPLICATIONS.has(name) &&
      !OPERATOR_RUN_DATA_APPLICATIONS.has(name),
  );
}

/** Local accounts have explicit targets in each Application's reviewed project; only the CP dispatch barrier has an exact workload edit grant. */
export function deliveryArgoPolicy(
  transition: boolean = transitionRendering(),
): string {
  const rows: string[] = [];
  const grant = (
    account: string,
    applications: string[],
    actions: string[],
  ) => {
    for (const application of applications) {
      const project = applicationProject(application, transition);
      for (const action of actions)
        rows.push(
          `p, ${account}, applications, ${action}, ${project}/${application}, allow`,
        );
    }
  };
  const known = deliveryKnownApplications(transition);
  if (transition) {
    // Delivery owns every Application object end to end (model section 8),
    // except the retained root and ArgoCD and the operator-run data layers.
    grant(
      "delivery",
      [...RETAINED_APPLICATIONS, ...OPERATOR_RUN_DATA_APPLICATIONS],
      ["get"],
    );
    grant("delivery", deliveryManagedApplications(transition), [
      "get",
      "create",
      "update",
      "delete",
      "sync",
    ]);
    grant("delivery-observer", known, ["get"]);
  } else {
    grant("delivery", ["apps"], ["get"]);
    grant("delivery", DELIVERY_WORKLOAD_APPLICATIONS, [
      "get",
      "update",
      "sync",
    ]);
    grant(
      "delivery-observer",
      ["apps", "delivery-control-plane", ...DELIVERY_WORKLOAD_APPLICATIONS],
      ["get"],
    );
  }
  // release-root inspects the complete child inventory but only synchronizes
  // root-owned children. Its local-manifest protocol belongs solely to apps.
  grant("delivery-platform", known, ["get"]);
  grant("delivery-platform", deliveryRootApplications(transition), ["sync"]);
  grant("delivery-platform", ["apps"], ["update", "sync", "override"]);
  grant("delivery-platform", ["delivery-control-plane"], ["update", "sync"]);
  grant(
    "delivery-platform",
    ["delivery-control-plane"],
    ["update/apps/Deployment/temporal/temporal-delivery-worker"],
  );
  return rows.join("\n");
}
