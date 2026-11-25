import type { NormalizedSentryEvent } from "#domain/envelope-normalize.ts";
import {
  computeFingerprint,
  extractIssueSummary,
} from "#domain/fingerprint.ts";
import {
  evaluateIssueIngestion,
  type OutboxAlertKind,
} from "#domain/lifecycle.ts";
import { renderStacktraceMarkdown } from "#domain/stacktrace-markdown.ts";
import {
  constantTimeStringEquals,
  parsePositiveIntId,
  shouldPreferCandidateIssueForFingerprint,
  type ResolvedUrlConfig,
  type StoredEventRow,
  type StoredIssueRow,
  type StoredProjectRow,
} from "#infrastructure/repository-helpers.ts";
import type {
  ImportedEventInput,
  IngestEventInput,
  IngestEventResult,
} from "#infrastructure/repository-types.ts";

export type StoredReleaseRow = {
  readonly id: string;
  readonly projectId: number;
  readonly version: string;
  readonly releasedAt: Date;
};

export type StoredOutboxRow = {
  readonly id: string;
  readonly issueId: string;
  readonly eventId: string;
  readonly kind: OutboxAlertKind;
  readonly messageId: string;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  readonly sentAt: Date | null;
  readonly lastError: string | null;
  readonly createdAt: Date;
};

export type StoredFingerprintRow = {
  readonly projectId: number;
  readonly fingerprint: string;
  readonly issueId: string;
  readonly createdAt: Date;
};

export type InMemoryStore = {
  readonly urls: ResolvedUrlConfig;
  readonly projects: Map<number, StoredProjectRow>;
  readonly issues: Map<string, StoredIssueRow>;
  readonly fingerprints: Map<string, StoredFingerprintRow>;
  readonly events: Map<string, StoredEventRow>;
  readonly eventKeyIndex: Map<string, string>;
  readonly releases: Map<string, StoredReleaseRow>;
  readonly outbox: Map<string, StoredOutboxRow>;
  nextProjectId: number;
};

export function findInMemoryProject(
  store: InMemoryStore,
  idOrSlug: string | number,
): StoredProjectRow | null {
  const numericId = parsePositiveIntId(idOrSlug);
  if (numericId !== null) {
    return store.projects.get(numericId) ?? null;
  }
  if (typeof idOrSlug === "string") {
    const slug = idOrSlug.trim();
    for (const project of store.projects.values()) {
      if (project.slug === slug) {
        return project;
      }
    }
  }
  return null;
}

export function upsertInMemoryRelease(
  store: InMemoryStore,
  projectId: number,
  version: string,
  options: {
    readonly releasedAt: Date;
    readonly explicitId?: string | undefined;
  },
): StoredReleaseRow {
  const key = `${String(projectId)}:${version}`;
  const existing = store.releases.get(key);
  const saved: StoredReleaseRow = {
    id: existing?.id ?? options.explicitId ?? crypto.randomUUID(),
    projectId,
    version,
    releasedAt: options.releasedAt,
  };
  store.releases.set(key, saved);
  return saved;
}

function findDuplicateInMemoryEvent(
  store: InMemoryStore,
  dedupeKey: string,
): IngestEventResult | null {
  const existingEventUuid = store.eventKeyIndex.get(dedupeKey);
  if (existingEventUuid === undefined) {
    return null;
  }
  const existingEvt = store.events.get(existingEventUuid);
  return existingEvt === undefined
    ? null
    : {
        status: "duplicate",
        eventId: existingEvt.eventId,
        issueId: existingEvt.issueId,
      };
}

function upsertIngestedInMemoryIssue(options: {
  readonly store: InMemoryStore;
  readonly project: StoredProjectRow;
  readonly fp: string;
  readonly fpKey: string;
  readonly existingIssue: StoredIssueRow | null;
  readonly normalizedEvent: NormalizedSentryEvent;
  readonly decision: ReturnType<typeof evaluateIssueIngestion>;
}): string {
  const {
    store,
    project,
    fp,
    fpKey,
    existingIssue,
    normalizedEvent,
    decision,
  } = options;
  const summary = extractIssueSummary(normalizedEvent);
  if (existingIssue === null) {
    const issueId = crypto.randomUUID();
    store.issues.set(issueId, {
      id: issueId,
      projectId: project.id,
      primaryFingerprint: fp,
      type: summary.type,
      value: summary.value,
      transaction: summary.transaction,
      level: summary.level,
      state: decision.state,
      resolvedInRelease: decision.resolvedInRelease,
      regressedCount: decision.regressedCount,
      digestedEventCount: 1n,
      storedEventCount: 1,
      firstSeen: normalizedEvent.timestamp,
      lastSeen: normalizedEvent.timestamp,
      lastRelease: normalizedEvent.release,
      lastAlertedAt: decision.lastAlertedAt,
      trackerIssueIdentifier: null,
      revision: 1,
    });
    store.fingerprints.set(fpKey, {
      projectId: project.id,
      fingerprint: fp,
      issueId,
      createdAt: store.urls.now(),
    });
    return issueId;
  }

  store.issues.set(existingIssue.id, {
    ...existingIssue,
    type: summary.type,
    value: summary.value,
    transaction: summary.transaction,
    level: summary.level,
    state: decision.state,
    resolvedInRelease: decision.resolvedInRelease,
    regressedCount: decision.regressedCount,
    digestedEventCount: existingIssue.digestedEventCount + 1n,
    storedEventCount: existingIssue.storedEventCount + 1,
    firstSeen:
      normalizedEvent.timestamp.getTime() < existingIssue.firstSeen.getTime()
        ? normalizedEvent.timestamp
        : existingIssue.firstSeen,
    lastSeen:
      normalizedEvent.timestamp.getTime() > existingIssue.lastSeen.getTime()
        ? normalizedEvent.timestamp
        : existingIssue.lastSeen,
    lastRelease: normalizedEvent.release ?? existingIssue.lastRelease,
    lastAlertedAt: decision.lastAlertedAt,
    revision: existingIssue.revision + 1,
  });
  return existingIssue.id;
}

function pruneInMemoryIssueEvents(
  store: InMemoryStore,
  issueId: string,
  retentionMaxEvents: number,
): number {
  const issueEvents = [...store.events.values()]
    .filter((e) => e.issueId === issueId)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  let pruned = 0;
  while (issueEvents.length - pruned > retentionMaxEvents) {
    const victim = issueEvents[pruned];
    if (victim === undefined) {
      break;
    }
    store.events.delete(victim.id);
    store.eventKeyIndex.delete(`${String(victim.projectId)}:${victim.eventId}`);
    pruned += 1;
  }
  const updatedIssue = store.issues.get(issueId);
  if (updatedIssue !== undefined && pruned > 0) {
    store.issues.set(issueId, {
      ...updatedIssue,
      storedEventCount: updatedIssue.storedEventCount - pruned,
    });
  }
  return pruned;
}

function enqueueInMemoryOutboxIfNeeded(
  store: InMemoryStore,
  issueId: string,
  eventId: string,
  outboxKind: OutboxAlertKind | null,
): string | null {
  if (outboxKind === null) {
    return null;
  }
  const outboxId = crypto.randomUUID();
  const now = store.urls.now();
  store.outbox.set(outboxId, {
    id: outboxId,
    issueId,
    eventId,
    kind: outboxKind,
    messageId: `errors-${outboxKind.toLowerCase()}-${issueId}-${eventId}`,
    attempts: 0,
    nextAttemptAt: now,
    sentAt: null,
    lastError: null,
    createdAt: now,
  });
  return outboxId;
}

export function ingestInMemoryEvent(
  store: InMemoryStore,
  input: IngestEventInput,
): IngestEventResult {
  const project = store.projects.get(input.projectId);
  if (
    project === undefined ||
    !constantTimeStringEquals(project.publicKey, input.publicKey)
  ) {
    return { status: "unauthorized" };
  }

  const { normalizedEvent } = input;
  const dedupeKey = `${String(project.id)}:${normalizedEvent.eventId}`;
  const duplicate = findDuplicateInMemoryEvent(store, dedupeKey);
  if (duplicate !== null) {
    return duplicate;
  }

  if (
    normalizedEvent.release !== null &&
    normalizedEvent.release.length > 0 &&
    !store.releases.has(`${String(project.id)}:${normalizedEvent.release}`)
  ) {
    upsertInMemoryRelease(store, project.id, normalizedEvent.release, {
      releasedAt: normalizedEvent.timestamp,
    });
  }

  const fp = computeFingerprint(normalizedEvent);
  const fpKey = `${String(project.id)}:${fp}`;
  const fpRecord = store.fingerprints.get(fpKey);
  const existingIssue =
    fpRecord === undefined
      ? null
      : (store.issues.get(fpRecord.issueId) ?? null);

  const decision = evaluateIssueIngestion({
    existingIssue:
      existingIssue === null
        ? null
        : {
            state: existingIssue.state,
            resolvedInRelease: existingIssue.resolvedInRelease,
            regressedCount: existingIssue.regressedCount,
            lastAlertedAt: existingIssue.lastAlertedAt,
          },
    incomingRelease: normalizedEvent.release,
    incomingTimestamp: normalizedEvent.timestamp,
    alertOnNewIssue: project.alertOnNewIssue,
    alertOnRegression: project.alertOnRegression,
  });

  const issueId = upsertIngestedInMemoryIssue({
    store,
    project,
    fp,
    fpKey,
    existingIssue,
    normalizedEvent,
    decision,
  });

  const eventUuid = crypto.randomUUID();
  store.events.set(eventUuid, {
    id: eventUuid,
    eventId: normalizedEvent.eventId,
    issueId,
    projectId: project.id,
    timestamp: normalizedEvent.timestamp,
    ingestedAt: store.urls.now(),
    release: normalizedEvent.release,
    environment: normalizedEvent.environment,
    platform: normalizedEvent.platform,
    level: normalizedEvent.level,
    transaction: normalizedEvent.transaction,
    data: structuredClone(normalizedEvent.rawData),
    stacktraceMd: renderStacktraceMarkdown(normalizedEvent),
  });
  store.eventKeyIndex.set(dedupeKey, eventUuid);

  const pruned = pruneInMemoryIssueEvents(
    store,
    issueId,
    project.retentionMaxEvents,
  );

  store.projects.set(project.id, {
    ...project,
    digestedEventCount: project.digestedEventCount + 1n,
    storedEventCount: project.storedEventCount + 1 - pruned,
  });

  return {
    status: "accepted",
    eventId: normalizedEvent.eventId,
    issueId,
    outboxId: enqueueInMemoryOutboxIfNeeded(
      store,
      issueId,
      normalizedEvent.eventId,
      decision.outboxKind,
    ),
    isNewIssue: existingIssue === null,
    regressed: decision.regressed,
  };
}

export function insertInMemoryImportedEvent(
  store: InMemoryStore,
  input: ImportedEventInput,
): { readonly inserted: boolean; readonly fingerprintRegistered: boolean } {
  const dedupeKey = `${String(input.projectId)}:${input.eventId}`;
  const inserted = !store.eventKeyIndex.has(dedupeKey);
  if (inserted) {
    store.events.set(input.id, {
      id: input.id,
      eventId: input.eventId,
      issueId: input.issueId,
      projectId: input.projectId,
      timestamp: input.timestamp,
      ingestedAt: input.ingestedAt,
      release: input.release,
      environment: input.environment,
      platform: input.platform,
      level: input.level,
      transaction: input.transaction,
      data: structuredClone(input.data),
      stacktraceMd: input.stacktraceMd,
    });
    store.eventKeyIndex.set(dedupeKey, input.id);
  }

  const targetIssue = store.issues.get(input.issueId);
  if (targetIssue === undefined) {
    return { inserted, fingerprintRegistered: false };
  }
  const fpKey = `${String(input.projectId)}:${input.computedFingerprint}`;
  const existingFp = store.fingerprints.get(fpKey);
  let fingerprintRegistered = false;
  if (existingFp === undefined) {
    store.fingerprints.set(fpKey, {
      projectId: input.projectId,
      fingerprint: input.computedFingerprint,
      issueId: targetIssue.id,
      createdAt: store.urls.now(),
    });
    fingerprintRegistered = true;
  } else if (existingFp.issueId !== targetIssue.id) {
    const currentOwner = store.issues.get(existingFp.issueId);
    if (
      currentOwner === undefined ||
      shouldPreferCandidateIssueForFingerprint(targetIssue, currentOwner)
    ) {
      store.fingerprints.set(fpKey, {
        projectId: input.projectId,
        fingerprint: input.computedFingerprint,
        issueId: targetIssue.id,
        createdAt: existingFp.createdAt,
      });
      fingerprintRegistered = true;
    }
  }
  return { inserted, fingerprintRegistered };
}
