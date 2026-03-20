import { bugsinkRequest, bugsinkRequestRaw } from "./client.ts";
import {
  BugsinkTeamSchema,
  BugsinkProjectDetailSchema,
  BugsinkEventListSchema,
  BugsinkEventDetailSchema,
  BugsinkReleaseListSchema,
  BugsinkReleaseDetailSchema,
  BugsinkPaginatedResponseSchema,
} from "./schemas.ts";
import type {
  BugsinkTeam,
  BugsinkProjectDetail,
  BugsinkEventListItem,
  BugsinkEventDetail,
  BugsinkReleaseListItem,
  BugsinkReleaseDetail,
} from "./types.ts";

export async function getTeams(): Promise<BugsinkTeam[]> {
  const result = await bugsinkRequest(
    "/teams/",
    BugsinkPaginatedResponseSchema(BugsinkTeamSchema),
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch teams");
  }

  return result.data.results;
}

export async function getTeam(uuid: string): Promise<BugsinkTeam | null> {
  const result = await bugsinkRequest(`/teams/${uuid}/`, BugsinkTeamSchema);

  if (!result.success) {
    if (result.error?.includes("404") === true) {
      return null;
    }
    throw new Error(result.error ?? "Failed to fetch team");
  }

  return result.data ?? null;
}

export async function getProjects(
  teamUuid?: string,
): Promise<BugsinkProjectDetail[]> {
  const params: Record<string, string> = {};

  if (teamUuid != null && teamUuid.length > 0) {
    params["team"] = teamUuid;
  }

  const result = await bugsinkRequest(
    "/projects/",
    BugsinkPaginatedResponseSchema(BugsinkProjectDetailSchema),
    params,
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch projects");
  }

  return result.data.results;
}

export async function getProject(
  id: number,
): Promise<BugsinkProjectDetail | null> {
  const result = await bugsinkRequest(
    `/projects/${String(id)}/`,
    BugsinkProjectDetailSchema,
  );

  if (!result.success) {
    if (result.error?.includes("404") === true) {
      return null;
    }
    throw new Error(result.error ?? "Failed to fetch project");
  }

  return result.data ?? null;
}

export async function getEvents(
  issueUuid: string,
): Promise<BugsinkEventListItem[]> {
  const result = await bugsinkRequest(
    "/events/",
    BugsinkPaginatedResponseSchema(BugsinkEventListSchema),
    { issue: issueUuid },
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch events");
  }

  return result.data.results;
}

export async function getEvent(
  uuid: string,
): Promise<BugsinkEventDetail | null> {
  const result = await bugsinkRequest(
    `/events/${uuid}/`,
    BugsinkEventDetailSchema,
  );

  if (!result.success) {
    if (result.error?.includes("404") === true) {
      return null;
    }
    throw new Error(result.error ?? "Failed to fetch event");
  }

  return result.data ?? null;
}

export async function getStacktrace(eventUuid: string): Promise<string> {
  const result = await bugsinkRequestRaw(`/events/${eventUuid}/stacktrace/`);

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch stacktrace");
  }

  return result.data;
}

export async function getReleases(
  projectId?: number,
): Promise<BugsinkReleaseListItem[]> {
  const params: Record<string, string> = {};

  if (projectId != null) {
    params["project"] = String(projectId);
  }

  const result = await bugsinkRequest(
    "/releases/",
    BugsinkPaginatedResponseSchema(BugsinkReleaseListSchema),
    params,
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch releases");
  }

  return result.data.results;
}

export async function getRelease(
  uuid: string,
): Promise<BugsinkReleaseDetail | null> {
  const result = await bugsinkRequest(
    `/releases/${uuid}/`,
    BugsinkReleaseDetailSchema,
  );

  if (!result.success) {
    if (result.error?.includes("404") === true) {
      return null;
    }
    throw new Error(result.error ?? "Failed to fetch release");
  }

  return result.data ?? null;
}
