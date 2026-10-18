import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import {
  ORDINARY_DELIVERY_ENVIRONMENTS,
  SPECIALIZED_DELIVERY_ENVIRONMENTS,
  applicationReleasePolicy,
} from "homelab/src/delivery-target-policy.ts";

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
export const DELIVERY_KNOWN_APPLICATIONS = [
  ...new Set([
    "apps",
    "delivery-control-plane",
    ...DELIVERY_WORKLOAD_APPLICATIONS,
    ...SERVICE_CATALOG.services.flatMap((service) => service.argoApps),
  ]),
].sort();
export const DELIVERY_ROOT_APPLICATIONS = DELIVERY_KNOWN_APPLICATIONS.filter(
  (name) =>
    name !== "apps" && applicationReleasePolicy(name).owner === "release-root",
);

/** Local accounts have explicit targets; only the CP dispatch barrier has an exact workload edit grant. */
export function deliveryArgoPolicy(): string {
  const rows: string[] = [];
  const grant = (
    account: string,
    applications: string[],
    actions: string[],
  ) => {
    for (const application of applications)
      for (const action of actions)
        rows.push(
          `p, ${account}, applications, ${action}, default/${application}, allow`,
        );
  };
  grant("delivery", ["apps"], ["get"]);
  grant("delivery", DELIVERY_WORKLOAD_APPLICATIONS, ["get", "update", "sync"]);
  grant(
    "delivery-observer",
    ["apps", "delivery-control-plane", ...DELIVERY_WORKLOAD_APPLICATIONS],
    ["get"],
  );
  // release-root inspects the complete child inventory but only synchronizes
  // root-owned children. Its local-manifest protocol belongs solely to apps.
  grant("delivery-platform", DELIVERY_KNOWN_APPLICATIONS, ["get"]);
  grant("delivery-platform", DELIVERY_ROOT_APPLICATIONS, ["sync"]);
  grant("delivery-platform", ["apps"], ["update", "sync", "override"]);
  grant("delivery-platform", ["delivery-control-plane"], ["update", "sync"]);
  grant(
    "delivery-platform",
    ["delivery-control-plane"],
    ["update/apps/Deployment/temporal/temporal-delivery-worker"],
  );
  return rows.join("\n");
}
