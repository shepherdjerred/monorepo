import {
  findInMemoryProject,
  upsertInMemoryRelease,
  type InMemoryStore,
} from "#infrastructure/in-memory-store.ts";
import { computeAggregatesByProject } from "#infrastructure/repository-aggregates.ts";
import {
  EMPTY_PROJECT_AGGREGATES,
  generatePublicKey,
  resolveNextReleaseValue,
  slugifyProjectName,
  toIssueListItem,
  toProjectSummary,
  type StoredIssueRow,
  type StoredProjectRow,
} from "#infrastructure/repository-helpers.ts";
import type {
  ClaimedOutboxNotification,
  ImportedIssueInput,
  ImportedProjectInput,
  UpdateIssueStateResult,
} from "#infrastructure/repository-types.ts";
import type { CanonicalProjectSeed } from "#infrastructure/seed-projects.ts";
import type {
  BulkUpdateIssuesInput,
  BulkUpdateIssuesResponse,
  CreateProjectInput,
  CreateReleaseInput,
  IssueListItem,
  ProjectSummary,
  ReleaseItem,
  UpdateIssueStateInput,
  UpdateProjectInput,
} from "#shared/contract.ts";

export function seedInMemoryCanonicalProjects(
  store: InMemoryStore,
  seeds: readonly CanonicalProjectSeed[],
): number {
  let inserted = 0;
  const now = store.urls.now();
  for (const seed of seeds) {
    const slugExists = [...store.projects.values()].some(
      (p) => p.slug === seed.slug || p.publicKey === seed.publicKey,
    );
    if (!slugExists && !store.projects.has(seed.id)) {
      store.projects.set(seed.id, {
        id: seed.id,
        slug: seed.slug,
        name: seed.name,
        publicKey: seed.publicKey,
        digestedEventCount: 0n,
        storedEventCount: 0,
        alertOnNewIssue: true,
        alertOnRegression: true,
        retentionMaxEvents: 50,
        createdAt: now,
      });
      inserted += 1;
    }
    if (seed.id >= store.nextProjectId) {
      store.nextProjectId = seed.id + 1;
    }
  }
  return inserted;
}

export function createInMemoryProject(
  store: InMemoryStore,
  input: CreateProjectInput,
): ProjectSummary {
  const baseSlug = input.slug ?? slugifyProjectName(input.name);
  let candidateSlug = baseSlug;
  let suffix = 2;
  while (findInMemoryProject(store, candidateSlug) !== null) {
    candidateSlug = `${baseSlug.slice(0, 45)}-${String(suffix)}`;
    suffix += 1;
  }
  const id = store.nextProjectId;
  store.nextProjectId += 1;
  const created: StoredProjectRow = {
    id,
    slug: candidateSlug,
    name: input.name,
    publicKey: generatePublicKey(),
    digestedEventCount: 0n,
    storedEventCount: 0,
    alertOnNewIssue: input.alertOnNewIssue,
    alertOnRegression: input.alertOnRegression,
    retentionMaxEvents: input.retentionMaxEvents,
    createdAt: store.urls.now(),
  };
  store.projects.set(id, created);
  return toProjectSummary(created, EMPTY_PROJECT_AGGREGATES, store.urls);
}

export function updateInMemoryProject(
  store: InMemoryStore,
  idOrSlug: string | number,
  input: UpdateProjectInput,
): ProjectSummary | null {
  const existing = findInMemoryProject(store, idOrSlug);
  if (existing === null) {
    return null;
  }
  const updated: StoredProjectRow = {
    ...existing,
    name: input.name ?? existing.name,
    alertOnNewIssue: input.alertOnNewIssue ?? existing.alertOnNewIssue,
    alertOnRegression: input.alertOnRegression ?? existing.alertOnRegression,
    retentionMaxEvents: input.retentionMaxEvents ?? existing.retentionMaxEvents,
  };
  store.projects.set(updated.id, updated);
  const projectIssues = [...store.issues.values()].filter(
    (i) => i.projectId === updated.id,
  );
  const aggregates = computeAggregatesByProject(
    [updated],
    projectIssues,
    store.urls.now(),
  );
  return toProjectSummary(
    updated,
    aggregates.get(updated.id) ?? EMPTY_PROJECT_AGGREGATES,
    store.urls,
  );
}

export function updateInMemoryIssueState(
  store: InMemoryStore,
  id: string,
  input: UpdateIssueStateInput,
): UpdateIssueStateResult {
  const current = store.issues.get(id);
  if (current === undefined) {
    return { status: "not_found" };
  }
  const project = store.projects.get(current.projectId);
  if (project === undefined) {
    return { status: "not_found" };
  }
  if (
    input.expectedRevision !== undefined &&
    current.revision !== input.expectedRevision
  ) {
    return {
      status: "conflict",
      current: toIssueListItem(current, project),
    };
  }
  const updated: StoredIssueRow = {
    ...current,
    state: input.state,
    resolvedInRelease: resolveNextReleaseValue(
      input.state,
      input.resolvedInRelease,
      current.lastRelease,
    ),
    revision: current.revision + 1,
  };
  store.issues.set(id, updated);
  return {
    status: "ok",
    issue: toIssueListItem(updated, project),
  };
}

export function bulkUpdateInMemoryIssues(
  store: InMemoryStore,
  input: BulkUpdateIssuesInput,
): BulkUpdateIssuesResponse {
  const items: IssueListItem[] = [];
  for (const id of input.ids) {
    const issue = store.issues.get(id);
    const project =
      issue === undefined ? undefined : store.projects.get(issue.projectId);
    if (issue !== undefined && project !== undefined) {
      const updated: StoredIssueRow = {
        ...issue,
        state: input.state,
        resolvedInRelease: resolveNextReleaseValue(
          input.state,
          input.resolvedInRelease,
          issue.lastRelease,
        ),
        revision: issue.revision + 1,
      };
      store.issues.set(id, updated);
      items.push(toIssueListItem(updated, project));
    }
  }
  return { updatedCount: items.length, items };
}

export function setInMemoryTrackerIssue(
  store: InMemoryStore,
  issueId: string,
  trackerIssueIdentifier: string,
): IssueListItem | null {
  const issue = store.issues.get(issueId);
  if (issue === undefined) {
    return null;
  }
  const project = store.projects.get(issue.projectId);
  if (project === undefined) {
    return null;
  }
  const updated: StoredIssueRow = {
    ...issue,
    trackerIssueIdentifier,
    revision: issue.revision + 1,
  };
  store.issues.set(issueId, updated);
  return toIssueListItem(updated, project);
}

export function createInMemoryRelease(
  store: InMemoryStore,
  input: CreateReleaseInput,
): ReleaseItem | null {
  const project = findInMemoryProject(store, input.project);
  if (project === null) {
    return null;
  }
  const releasedAt =
    input.releasedAt === undefined
      ? store.urls.now()
      : new Date(input.releasedAt);
  const saved = upsertInMemoryRelease(store, project.id, input.version, {
    releasedAt,
  });
  return {
    id: saved.id,
    projectId: saved.projectId,
    projectSlug: project.slug,
    version: saved.version,
    releasedAt: saved.releasedAt.toISOString(),
  };
}

export function upsertInMemoryImportedProject(
  store: InMemoryStore,
  input: ImportedProjectInput,
): void {
  const existing = store.projects.get(input.id);
  store.projects.set(input.id, {
    id: input.id,
    slug: existing?.slug ?? input.slug,
    name: input.name,
    publicKey: existing?.publicKey ?? input.publicKey,
    digestedEventCount: BigInt(input.digestedEventCount),
    storedEventCount: existing?.storedEventCount ?? input.storedEventCount,
    alertOnNewIssue: input.alertOnNewIssue,
    alertOnRegression: input.alertOnRegression,
    retentionMaxEvents: existing?.retentionMaxEvents ?? 50,
    createdAt: existing?.createdAt ?? store.urls.now(),
  });
  if (input.id >= store.nextProjectId) {
    store.nextProjectId = input.id + 1;
  }
}

export function upsertInMemoryImportedIssue(
  store: InMemoryStore,
  input: ImportedIssueInput,
): void {
  const legacyFp = `legacy:bugsink:${input.id}`;
  const existing = store.issues.get(input.id);
  store.issues.set(input.id, {
    id: input.id,
    projectId: input.projectId,
    primaryFingerprint: existing?.primaryFingerprint ?? legacyFp,
    type: input.type,
    value: input.value,
    transaction: input.transaction,
    level: input.level,
    state: input.state,
    resolvedInRelease: existing?.resolvedInRelease ?? null,
    regressedCount: existing?.regressedCount ?? 0,
    digestedEventCount: BigInt(input.digestedEventCount),
    storedEventCount: existing?.storedEventCount ?? input.storedEventCount,
    firstSeen: input.firstSeen,
    lastSeen: input.lastSeen,
    lastRelease: existing?.lastRelease ?? null,
    lastAlertedAt: existing?.lastAlertedAt ?? null,
    trackerIssueIdentifier: existing?.trackerIssueIdentifier ?? null,
    revision: existing?.revision ?? 1,
  });
  store.fingerprints.set(`${String(input.projectId)}:${legacyFp}`, {
    projectId: input.projectId,
    fingerprint: legacyFp,
    issueId: input.id,
    createdAt: store.urls.now(),
  });
}

export function completeInMemoryOutbox(
  store: InMemoryStore,
  id: string,
  sentAt?: Date,
): void {
  const existing = store.outbox.get(id);
  if (existing !== undefined) {
    store.outbox.set(id, {
      ...existing,
      sentAt: sentAt ?? store.urls.now(),
      lastError: null,
      attempts: existing.attempts + 1,
    });
  }
}

export function failInMemoryOutbox(
  store: InMemoryStore,
  id: string,
  errorMessage: string,
  nextAttemptAt: Date,
): void {
  const existing = store.outbox.get(id);
  if (existing !== undefined) {
    store.outbox.set(id, {
      ...existing,
      attempts: existing.attempts + 1,
      lastError: errorMessage,
      nextAttemptAt,
    });
  }
}

export function reconcileInMemoryImportedCounts(
  store: InMemoryStore,
  projectIds?: readonly number[],
): void {
  const filterSet =
    projectIds === undefined || projectIds.length === 0
      ? null
      : new Set(projectIds);
  for (const project of store.projects.values()) {
    if (filterSet !== null && !filterSet.has(project.id)) {
      continue;
    }
    const projectIssues = [...store.issues.values()].filter(
      (i) => i.projectId === project.id,
    );
    let projectStored = 0;
    let projectDigestedSum = 0n;
    for (const issue of projectIssues) {
      const issueEvents = [...store.events.values()]
        .filter((e) => e.issueId === issue.id)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const latestRelease =
        issueEvents.find((e) => e.release !== null)?.release ??
        issue.lastRelease;
      projectStored += issueEvents.length;
      projectDigestedSum += issue.digestedEventCount;
      store.issues.set(issue.id, {
        ...issue,
        storedEventCount: issueEvents.length,
        lastRelease: latestRelease,
      });
    }
    store.projects.set(project.id, {
      ...project,
      storedEventCount: projectStored,
      digestedEventCount:
        project.digestedEventCount > projectDigestedSum
          ? project.digestedEventCount
          : projectDigestedSum,
    });
  }
}

export function claimInMemoryOutbox(
  store: InMemoryStore,
  limit: number,
  currentNow: Date,
): ClaimedOutboxNotification[] {
  const due = [...store.outbox.values()]
    .filter(
      (row) =>
        row.sentAt === null &&
        row.nextAttemptAt.getTime() <= currentNow.getTime(),
    )
    .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
    .slice(0, limit);

  const claimed: ClaimedOutboxNotification[] = [];
  for (const row of due) {
    store.outbox.set(row.id, {
      ...row,
      nextAttemptAt: new Date(currentNow.getTime() + 60_000),
    });
    const issue = store.issues.get(row.issueId);
    const project =
      issue === undefined ? undefined : store.projects.get(issue.projectId);
    if (issue !== undefined && project !== undefined) {
      const evt = [...store.events.values()].find(
        (e) => e.projectId === project.id && e.eventId === row.eventId,
      );
      claimed.push({
        id: row.id,
        issueId: row.issueId,
        eventId: row.eventId,
        kind: row.kind,
        messageId: row.messageId,
        attempts: row.attempts,
        projectSlug: project.slug,
        projectName: project.name,
        issueType: issue.type,
        issueValue: issue.value,
        transaction: issue.transaction,
        release: evt?.release ?? issue.lastRelease,
        environment: evt?.environment ?? null,
        stacktraceMd: evt?.stacktraceMd ?? "",
      });
    }
  }
  return claimed;
}
