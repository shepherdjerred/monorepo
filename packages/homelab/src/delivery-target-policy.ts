import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import { STATIC_SITE_DESTINATIONS } from "@shepherdjerred/ops-model/static-release-targets.ts";

export const STATIC_BUCKET_RELEASE_POLICIES: Readonly<Record<string, string>> =
  {
    ...STATIC_SITE_DESTINATIONS,
  };

/**
 * Applications whose v1 Delivery registration declares a specialized
 * execution adapter (`packages/delivery/registrations/specialized/`). Every
 * other delegated Application is ordinary: its v1 registration lives under
 * `registrations/ordinary/`, and the shared pass in
 * `cdk8s/src/ordinary-delivery-image-bindings.ts` binds its workload images
 * to its catalog images. Specialized charts bind their own images, apart from
 * `temporal` and `delivery-control-plane`, which that pass handles by name.
 *
 * The catalog's `legacy.deliveryDelegations` names only each Application's
 * environment, so this split stays here: only the homelab reads it, and
 * `legacy` is the transitional v1 section deleted with the root release.
 */
const SPECIALIZED_DELIVERY_APPLICATIONS: ReadonlySet<string> = new Set([
  "temporal",
  "delivery-control-plane",
  "scout-beta",
  "scout-prod",
  "storm-forum",
  "storm-forum-beta",
  "minecraft-tsmc",
]);

/**
 * Delegations reviewed ahead of their catalog environment. A catalog
 * delegation activates Delivery ownership, so an Application whose chart is
 * still inactive is declared here first and moves to the catalog when its
 * environment exists. The completeness check exempts each entry by name in
 * `scripts/checks/service-registration-exemptions.json`.
 */
const PENDING_DELIVERY_DELEGATIONS: Readonly<Record<string, string>> = {
  "storm-forum-beta": "storm-forum/beta",
};

function reviewedDelegations(): Readonly<Record<string, string>> {
  const active = SERVICE_CATALOG.deliveryDelegations ?? {};
  for (const application of Object.keys(PENDING_DELIVERY_DELEGATIONS))
    if (active[application] !== undefined)
      throw new Error(
        `Pending Delivery delegation ${application} is in the catalog now; delete it from PENDING_DELIVERY_DELEGATIONS`,
      );
  const reviewed = { ...active, ...PENDING_DELIVERY_DELEGATIONS };
  for (const application of SPECIALIZED_DELIVERY_APPLICATIONS)
    if (reviewed[application] === undefined)
      throw new Error(
        `Specialized Delivery application ${application} has no catalog or pending delegation`,
      );
  return reviewed;
}

function delegationsWhere(
  specialized: boolean,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(reviewedDelegations()).filter(
      ([application]) =>
        SPECIALIZED_DELIVERY_APPLICATIONS.has(application) === specialized,
    ),
  );
}

/**
 * Reviewed application release boundaries, derived from the catalog's
 * delegations and the pending ones above; these declarations do not activate
 * writers.
 */
export const ORDINARY_DELIVERY_ENVIRONMENTS: Readonly<Record<string, string>> =
  delegationsWhere(false);

export const SPECIALIZED_DELIVERY_ENVIRONMENTS: Readonly<
  Record<string, string>
> = delegationsWhere(true);

const INFRASTRUCTURE_SERVICE_OWNERS = new Set([
  "gitops",
  "observability",
  "bugsink",
  "ci",
  "storage",
  "networking",
  "platform-services",
  "home",
  "self-hosted-apps",
  "minecraft",
  // Operator-run PostgreSQL data layers: never an automated Delivery target.
  "delivery-data",
  "temporal-data",
]);

export type ApplicationReleasePolicy =
  | {
      owner: "delivery";
      environmentId: string;
      adapter: "ordinary" | "specialized";
    }
  | { owner: "release-root"; reason: string };

/** Unknown first-party targets fail instead of silently inheriting root's writer. */
export function applicationReleasePolicy(
  application: string,
): ApplicationReleasePolicy {
  const ordinary = ORDINARY_DELIVERY_ENVIRONMENTS[application];
  if (ordinary !== undefined)
    return { owner: "delivery", environmentId: ordinary, adapter: "ordinary" };
  const specialized = SPECIALIZED_DELIVERY_ENVIRONMENTS[application];
  if (specialized !== undefined)
    return {
      owner: "delivery",
      environmentId: specialized,
      adapter: "specialized",
    };
  const catalog = new ServiceIndex();
  const service =
    catalog.byArgoApp(application) ?? catalog.byChart(application);
  if (service === undefined || !INFRASTRUCTURE_SERVICE_OWNERS.has(service.id))
    throw new Error(
      `Application ${application} needs an explicit release-owner policy`,
    );
  return {
    owner: "release-root",
    reason:
      application === "apps" || application === "argocd"
        ? "Root/controller infrastructure uses the guarded release-root procedure"
        : "Infrastructure or third-party workload: repo-owned chart and pinned upstream inputs remain under release-root",
  };
}

export const INDEPENDENT_STATIC_BUCKET_OWNERS: Readonly<
  Record<string, string>
> = {
  clauderon:
    "Cloudflare redirect lifecycle; retained compatibility bucket has no website producer",
  "public-sjer-red":
    "Artifact publication (toolkit pr asset); no website archive writer",
  "scout-desktop":
    "Manual Scout Desktop release publication (installers and update feeds); no website archive writer",
};
