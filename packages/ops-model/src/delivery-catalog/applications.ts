import {
  CATALOG_CORE,
  type CatalogCore,
} from "@shepherdjerred/ops-model/delivery-catalog/core.ts";

/**
 * Environments whose Application name differs from their service id. Every
 * other `<service>/prod` kubernetes-application environment is realised by
 * the Application named after its service.
 */
export const ENVIRONMENT_APPLICATIONS: Readonly<Record<string, string>> = {
  "scout-for-lol/beta": "scout-beta",
  "scout-for-lol/prod": "scout-prod",
  "tasknotes-server/prod": "tasknotes",
  "discord-plays-pokemon/prod": "pokemon",
  "discord-plays-mario-kart/prod": "mario-kart",
  "starlight-karma-bot/beta": "starlight-karma-bot-beta",
  "starlight-karma-bot/prod": "starlight-karma-bot-prod",
  "streambot/prod": "media",
  "static-site-proxy/prod": "s3-static-sites",
  "minecraft/sandbox": "mc-sandbox",
  "minecraft/tsmc": "minecraft-tsmc",
  "ops-dashboard/prod": "alert-dashboard",
};

/**
 * The catalog environment whose recipe deploys an Application, by name: an
 * environment the table above names, or else `<name>/prod`. Undefined for an
 * Application no environment deploys (the root, retired and channel-less
 * Applications).
 */
export function catalogApplicationEnvironment(
  name: string,
  core: CatalogCore = CATALOG_CORE,
): string | undefined {
  for (const [environmentId, application] of Object.entries(
    ENVIRONMENT_APPLICATIONS,
  ))
    if (application === name) return environmentId;
  const conventional = `${name}/prod`;
  if (Object.hasOwn(ENVIRONMENT_APPLICATIONS, conventional)) return;
  return core.environments.some(
    (environment) => environment.id === conventional,
  )
    ? conventional
    : undefined;
}
