/**
 * Browser routes for the Hub client module (`/incidents`). The server builds
 * the same detail URL for `IncidentSummary.url`; both derive from the
 * contract's identifier format.
 */
import { INCIDENTS_MODULE_ID, incidentIdentifier } from "#shared/contract.ts";

export const INCIDENTS_BASE_PATH = `/${INCIDENTS_MODULE_ID}`;

export function incidentPath(number: number): string {
  return `${INCIDENTS_BASE_PATH}/${incidentIdentifier(number)}`;
}
