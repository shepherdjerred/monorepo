/**
 * Hub's adapter for the Incidents client module: the package exports a
 * structurally compatible object and `satisfies` checks it against Hub's
 * `ClientModule` contract here, where that contract is visible.
 */
import { incidentsHubClient } from "@shepherdjerred/incidents/hub-client";

import type { ClientModule } from "#client/platform/module.ts";

export const incidentsClientModule: ClientModule =
  incidentsHubClient satisfies ClientModule;
