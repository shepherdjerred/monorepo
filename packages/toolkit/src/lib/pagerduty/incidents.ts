import { pagerDutyRequest } from "./client.ts";
import {
  PagerDutyIncidentsResponseSchema,
  PagerDutyIncidentResponseSchema,
  PagerDutyNotesResponseSchema,
  PagerDutyLogEntriesResponseSchema,
} from "./schemas.ts";
import type {
  PagerDutyIncident,
  PagerDutyNote,
  PagerDutyLogEntry,
} from "./types.ts";

export type GetIncidentsOptions = {
  statuses?: ("triggered" | "acknowledged" | "resolved")[] | undefined;
  limit?: number | undefined;
  serviceIds?: string[] | undefined;
  teamIds?: string[] | undefined;
};

export async function getIncidents(
  options: GetIncidentsOptions = {},
): Promise<PagerDutyIncident[]> {
  const params: Record<string, string | string[]> = {};

  const statuses = options.statuses ?? ["triggered", "acknowledged"];
  params["statuses[]"] = statuses;

  if (options.limit != null) {
    params["limit"] = String(options.limit);
  }

  if (options.serviceIds != null && options.serviceIds.length > 0) {
    params["service_ids[]"] = options.serviceIds;
  }

  if (options.teamIds != null && options.teamIds.length > 0) {
    params["team_ids[]"] = options.teamIds;
  }

  const result = await pagerDutyRequest(
    "/incidents",
    PagerDutyIncidentsResponseSchema,
    params,
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch incidents");
  }

  return result.data.incidents;
}

export async function getIncident(
  incidentId: string,
): Promise<PagerDutyIncident | null> {
  const result = await pagerDutyRequest(
    `/incidents/${incidentId}`,
    PagerDutyIncidentResponseSchema,
  );

  if (!result.success) {
    if (result.error?.includes("404") === true) {
      return null;
    }
    throw new Error(result.error ?? "Failed to fetch incident");
  }

  return result.data?.incident ?? null;
}

export async function getIncidentNotes(
  incidentId: string,
): Promise<PagerDutyNote[]> {
  const result = await pagerDutyRequest(
    `/incidents/${incidentId}/notes`,
    PagerDutyNotesResponseSchema,
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch incident notes");
  }

  return result.data.notes;
}

export async function getIncidentLogEntries(
  incidentId: string,
  limit = 25,
): Promise<PagerDutyLogEntry[]> {
  const result = await pagerDutyRequest(
    `/incidents/${incidentId}/log_entries`,
    PagerDutyLogEntriesResponseSchema,
    { limit: String(limit) },
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch incident log entries");
  }

  return result.data.log_entries;
}
