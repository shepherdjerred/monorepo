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
/**
 * The retained root stays read-only for Delivery. ArgoCD itself is a
 * self-hosted service Delivery deploys like any other Application, under the
 * global dispatch barrier (model D8 and section 8).
 */
const RETAINED_APPLICATIONS = new Set(["apps"]);
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

function grantRows(
  account: string,
  applications: readonly string[],
  actions: readonly string[],
  transition: boolean,
): string[] {
  return applications.flatMap((application) => {
    const project = applicationProject(application, transition);
    return actions.map(
      (action) =>
        `p, ${account}, applications, ${action}, ${project}/${application}, allow`,
    );
  });
}

/**
 * `release-root`'s account: it inspects the complete child inventory but
 * only synchronizes root-owned children. Its local-manifest protocol belongs
 * solely to apps.
 */
function releaseRootRows(transition: boolean): string[] {
  const grant = (applications: readonly string[], actions: string[]) =>
    grantRows("delivery-platform", applications, actions, transition);
  return [
    ...grant(deliveryKnownApplications(transition), ["get"]),
    ...grant(deliveryRootApplications(transition), ["sync"]),
    ...grant(["apps"], ["update", "sync", "override"]),
    ...grant(["delivery-control-plane"], ["update", "sync"]),
    ...grant(
      ["delivery-control-plane"],
      ["update/apps/Deployment/temporal/temporal-delivery-worker"],
    ),
  ];
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
    rows.push(...grantRows(account, applications, actions, transition));
  };
  const known = deliveryKnownApplications(transition);
  if (transition) {
    // Delivery owns every Application object end to end (model section 8),
    // ArgoCD's included, except the retained root and the operator-run data
    // layers.
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
  rows.push(...releaseRootRows(transition));
  // Before the window, release-root already holds its rows in the transition
  // projects too (window step 3b installs them): the final v1 root release
  // (step 4b) moves every child into `cluster` or `workloads` before `argocd`
  // syncs the transition policy. A grant on a project that does not exist yet
  // matches nothing.
  if (!transition) {
    const present = new Set(rows);
    rows.push(...releaseRootRows(true).filter((row) => !present.has(row)));
  }
  return rows.join("\n");
}
