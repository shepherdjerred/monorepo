import {
  bugsinkRequest,
  bugsinkRequestPaginated,
  bugsinkRequestRaw,
} from "./client.ts";
import {
  BugsinkTeamSchema,
  BugsinkProjectDetailSchema,
  BugsinkEventListSchema,
  BugsinkEventDetailSchema,
  BugsinkReleaseListSchema,
  BugsinkReleaseDetailSchema,
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
  const result = await bugsinkRequestPaginated("/teams/", BugsinkTeamSchema);

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch teams");
  }

  return result.data;
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

  const result = await bugsinkRequestPaginated(
    "/projects/",
    BugsinkProjectDetailSchema,
    params,
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch projects");
  }

  return result.data;
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
  const result = await bugsinkRequestPaginated(
    "/events/",
    BugsinkEventListSchema,
    { issue: issueUuid },
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch events");
  }

  return result.data;
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
  project?: number | string,
): Promise<BugsinkReleaseListItem[]> {
  const params: Record<string, string> = {};

  if (project != null) {
    params["project"] =
      typeof project === "number"
        ? String(project)
        : await resolveProjectSlug(project);
  }

  const result = await bugsinkRequestPaginated(
    "/releases/",
    BugsinkReleaseListSchema,
    params,
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch releases");
  }

  return result.data;
}

async function resolveProjectSlug(project: string): Promise<string> {
  if (/^\d+$/.test(project)) {
    return project;
  }

  const projects = await getProjects();
  const match = projects.find((candidate) => candidate.slug === project);
  if (match === undefined) {
    throw new Error(`Bugsink project slug not found: ${project}`);
  }
  return String(match.id);
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
