/**
 * Hub's adapter for the Incidents server module. The module lives in its own
 * package because it owns a PostgreSQL database; this file only proves, with
 * `satisfies`, that the package's object is a Hub `ServerModule`, so the
 * package never has to import alert-dashboard.
 */
import {
  createIncidentsFixtureHubServer,
  createIncidentsHubServer,
  type IncidentsHubServerOptions,
} from "@shepherdjerred/incidents/hub-server";

import type { ServerModule } from "#server/platform/module";

export function createIncidentsServerModule(
  options: IncidentsHubServerOptions,
): ServerModule {
  return createIncidentsHubServer(options) satisfies ServerModule;
}

/** The seeded in-memory module for `dev:fixture` and the Playwright server. */
export async function createFixtureIncidentsServerModule(): Promise<ServerModule> {
  const fixture = await createIncidentsFixtureHubServer();
  return fixture satisfies ServerModule;
}
