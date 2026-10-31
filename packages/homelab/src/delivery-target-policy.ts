import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { STATIC_SITE_DESTINATIONS } from "@shepherdjerred/ops-model/static-release-targets.ts";

export const STATIC_BUCKET_RELEASE_POLICIES: Readonly<Record<string, string>> =
  {
    ...STATIC_SITE_DESTINATIONS,
  };

/** Reviewed application release boundaries; these declarations do not activate writers. */
export const ORDINARY_DELIVERY_ENVIRONMENTS: Readonly<Record<string, string>> =
  {
    arcade: "arcade/prod",
    birmel: "birmel/prod",
    tasknotes: "tasknotes-server/prod",
    tracker: "tracker/prod",
    delivery: "delivery/prod",
    "trmnl-dashboard": "trmnl-dashboard/prod",
    "alert-dashboard": "ops-dashboard/prod",
    "storm-brain": "storm-brain/prod",
    "starlight-karma-bot-beta": "starlight-karma-bot/beta",
    "starlight-karma-bot-prod": "starlight-karma-bot/prod",
    redlib: "self-hosted-apps/redlib",
    media: "streambot/prod",
    "s3-static-sites": "static-sites/proxy",
    "glitter-boys-launcher": "glitter-boys-launcher/prod",
  };

export const SPECIALIZED_DELIVERY_ENVIRONMENTS: Readonly<
  Record<string, string>
> = {
  temporal: "temporal/prod",
  "delivery-control-plane": "delivery-control-plane/prod",
  "scout-beta": "scout-for-lol/beta",
  "scout-prod": "scout-for-lol/prod",
  "storm-forum": "storm-forum/prod",
  "storm-forum-beta": "storm-forum/beta",
  "minecraft-tsmc": "minecraft/tsmc",
};

const INFRASTRUCTURE_SERVICE_OWNERS = new Set([
  "gitops",
  "observability",
  "bugsink",
  "ci",
  "storage",
  "networking",
  "mail",
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
};
