import { z } from "zod";
import { normalizeSentryEventPayload } from "#domain/envelope-normalize.ts";
import { computeFingerprint } from "#domain/fingerprint.ts";
import { renderStacktraceMarkdown } from "#domain/stacktrace-markdown.ts";
import {
  BugsinkEventDetailSchema,
  BugsinkEventListItemSchema,
  BugsinkIssueItemSchema,
  BugsinkProjectItemSchema,
  BugsinkReleaseItemSchema,
  createPaginatedSchema,
} from "#infrastructure/bugsink-schemas.ts";
import { generatePublicKey } from "#infrastructure/repository-helpers.ts";
import type { ErrorsRepository } from "#infrastructure/repository-types.ts";
import type { BugsinkImportResult, IssueState } from "#shared/contract.ts";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RunBugsinkImportOptions = {
  readonly baseUrl: string;
  readonly token: string;
  readonly repo: ErrorsRepository;
  readonly dryRun?: boolean | undefined;
  readonly concurrency?: number | undefined;
  readonly projectId?: number | undefined;
  readonly fetchFn?: FetchLike | undefined;
  readonly maxPages?: number | undefined;
};

function normalizeBugsinkBaseUrl(rawUrl: string): {
  readonly apiBase: string;
  readonly origin: string;
} {
  const parsed = new URL(z.url().parse(rawUrl));
  const stripped = parsed
    .toString()
    .replace(/\/+$/u, "")
    .replace(/\/api\/canonical\/0$/u, "");
  return {
    apiBase: `${stripped}/api/canonical/0`,
    origin: parsed.origin,
  };
}

function mapBugsinkIssueState(
  issue: z.infer<typeof BugsinkIssueItemSchema>,
): IssueState {
  if (issue.is_muted) {
    return "MUTED";
  }
  if (issue.is_resolved_by_next_release) {
    return "RESOLVED_NEXT_RELEASE";
  }
  return issue.is_resolved ? "RESOLVED" : "OPEN";
}

function extractPublicKeyFromDsn(dsn: string | undefined): string | null {
  if (dsn === undefined || dsn.trim().length === 0) {
    return null;
  }
  try {
    const parsed = new URL(dsn);
    return parsed.username.length > 0
      ? decodeURIComponent(parsed.username)
      : null;
  } catch {
    return null;
  }
}

async function fetchBugsinkJson<T>(options: {
  readonly url: string;
  readonly token: string;
  readonly schema: z.ZodType<T>;
  readonly fetchFn: FetchLike;
}): Promise<T> {
  const response = await options.fetchFn(options.url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Bugsink API ${options.url} failed (${String(response.status)}): ${text.slice(0, 200)}`,
    );
  }
  const rawJson: unknown = JSON.parse(text);
  return options.schema.parse(rawJson);
}

async function fetchAllBugsinkPages<T>(options: {
  readonly initialUrl: string;
  readonly expectedOrigin: string;
  readonly token: string;
  readonly itemSchema: z.ZodType<T>;
  readonly fetchFn: FetchLike;
  readonly maxPages: number;
}): Promise<T[]> {
  const PageSchema = createPaginatedSchema(options.itemSchema);
  const collected: T[] = [];
  const seenUrls = new Set<string>();
  let nextUrl: string | null = options.initialUrl;

  for (let page = 1; page <= options.maxPages; page += 1) {
    if (nextUrl === null) {
      return collected;
    }
    const parsedNext = new URL(nextUrl);
    if (parsedNext.origin !== options.expectedOrigin) {
      throw new Error(
        `Refusing Bugsink pagination URL on unexpected origin: ${nextUrl}`,
      );
    }
    if (seenUrls.has(nextUrl)) {
      throw new Error(`Bugsink pagination cycle detected at ${nextUrl}`);
    }
    seenUrls.add(nextUrl);

    const data: { next?: string | null | undefined; results: T[] } =
      await fetchBugsinkJson({
        url: nextUrl,
        token: options.token,
        schema: PageSchema,
        fetchFn: options.fetchFn,
      });
    collected.push(...data.results);
    nextUrl =
      data.next !== undefined && data.next !== null && data.next.length > 0
        ? data.next
        : null;
  }

  throw new Error(
    `Bugsink pagination exceeded ${String(options.maxPages)} pages.`,
  );
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      const item = items[currentIndex];
      if (item !== undefined) {
        await worker(item);
      }
    }
  });
  await Promise.all(runners);
}

function parseSafeDate(raw: string | null | undefined): Date {
  if (raw === undefined || raw === null || raw.length === 0) {
    return new Date();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

type ImportContext = {
  readonly apiBase: string;
  readonly origin: string;
  readonly token: string;
  readonly repo: ErrorsRepository;
  readonly dryRun: boolean;
  readonly concurrency: number;
  readonly fetchFn: FetchLike;
  readonly maxPages: number;
};

type ImportCounters = {
  projectsImported: number;
  releasesImported: number;
  issuesImported: number;
  eventsImported: number;
  eventsSkippedExisting: number;
  fingerprintsRegistered: number;
};

async function resolveImportedProjectPublicKey(
  ctx: ImportContext,
  rawProject: z.infer<typeof BugsinkProjectItemSchema>,
): Promise<string> {
  const fromList = extractPublicKeyFromDsn(rawProject.dsn);
  if (fromList !== null) {
    return fromList;
  }
  const detail = await fetchBugsinkJson({
    url: `${ctx.apiBase}/projects/${String(rawProject.id)}/`,
    token: ctx.token,
    schema: BugsinkProjectItemSchema,
    fetchFn: ctx.fetchFn,
  });
  return extractPublicKeyFromDsn(detail.dsn) ?? generatePublicKey();
}

async function importProjectReleases(
  ctx: ImportContext,
  projectId: number,
): Promise<number> {
  const projectReleases = await fetchAllBugsinkPages({
    initialUrl: `${ctx.apiBase}/releases/?project=${String(projectId)}`,
    expectedOrigin: ctx.origin,
    token: ctx.token,
    itemSchema: BugsinkReleaseItemSchema,
    fetchFn: ctx.fetchFn,
    maxPages: ctx.maxPages,
  });
  const validReleases = projectReleases.filter(
    (rel) => rel.version.trim().length > 0,
  );
  if (!ctx.dryRun) {
    for (const rel of validReleases) {
      await ctx.repo.upsertImportedRelease({
        id: rel.id,
        projectId,
        version: rel.version,
        releasedAt: parseSafeDate(rel.date_released),
      });
    }
  }
  return validReleases.length;
}

async function importProjectIssues(
  ctx: ImportContext,
  projectId: number,
): Promise<z.infer<typeof BugsinkIssueItemSchema>[]> {
  const projectIssues = await fetchAllBugsinkPages({
    initialUrl: `${ctx.apiBase}/issues/?project=${String(projectId)}`,
    expectedOrigin: ctx.origin,
    token: ctx.token,
    itemSchema: BugsinkIssueItemSchema,
    fetchFn: ctx.fetchFn,
    maxPages: ctx.maxPages,
  });
  if (!ctx.dryRun) {
    for (const issue of projectIssues) {
      await ctx.repo.upsertImportedIssue({
        id: issue.id,
        projectId,
        type:
          issue.calculated_type.trim().length > 0
            ? issue.calculated_type
            : "Error",
        value: issue.calculated_value,
        transaction: issue.transaction,
        level: "error",
        state: mapBugsinkIssueState(issue),
        digestedEventCount: issue.digested_event_count,
        storedEventCount: issue.stored_event_count,
        firstSeen: parseSafeDate(issue.first_seen),
        lastSeen: parseSafeDate(issue.last_seen),
      });
    }
  }
  return projectIssues;
}

async function importSingleEventSummary(
  ctx: ImportContext,
  projectId: number,
  issueId: string,
  summary: z.infer<typeof BugsinkEventListItemSchema>,
): Promise<{ readonly imported: number; readonly registered: number }> {
  const detail = await fetchBugsinkJson({
    url: `${ctx.apiBase}/events/${summary.id}/`,
    token: ctx.token,
    schema: BugsinkEventDetailSchema,
    fetchFn: ctx.fetchFn,
  });
  const normalized = normalizeSentryEventPayload(detail.data, detail.event_id);
  const computedFp = computeFingerprint(normalized);
  const stacktraceMd =
    detail.stacktrace_md.trim().length > 0
      ? detail.stacktrace_md
      : renderStacktraceMarkdown(normalized);

  if (ctx.dryRun) {
    return { imported: 1, registered: 1 };
  }

  const saved = await ctx.repo.insertImportedEvent({
    id: detail.id,
    eventId: detail.event_id,
    issueId,
    projectId,
    timestamp: parseSafeDate(detail.timestamp),
    ingestedAt: parseSafeDate(detail.ingested_at ?? detail.timestamp),
    release: normalized.release,
    environment: normalized.environment,
    platform: normalized.platform,
    level: normalized.level,
    transaction: normalized.transaction,
    data: detail.data,
    stacktraceMd,
    computedFingerprint: computedFp,
  });
  return {
    imported: saved.inserted ? 1 : 0,
    registered: saved.fingerprintRegistered ? 1 : 0,
  };
}

async function importEventsForIssue(
  ctx: ImportContext,
  projectId: number,
  issueId: string,
  counters: ImportCounters,
): Promise<void> {
  const eventSummaries = await fetchAllBugsinkPages({
    initialUrl: `${ctx.apiBase}/events/?issue=${issueId}`,
    expectedOrigin: ctx.origin,
    token: ctx.token,
    itemSchema: BugsinkEventListItemSchema,
    fetchFn: ctx.fetchFn,
    maxPages: ctx.maxPages,
  });
  const existingIds = ctx.dryRun
    ? new Set<string>()
    : await ctx.repo.listExistingEventIdsForIssue(issueId);

  const missingSummaries = eventSummaries.filter((item) => {
    if (existingIds.has(item.event_id)) {
      counters.eventsSkippedExisting += 1;
      return false;
    }
    return true;
  });

  await runWithConcurrency(
    missingSummaries,
    ctx.concurrency,
    async (summary) => {
      const delta = await importSingleEventSummary(
        ctx,
        projectId,
        issueId,
        summary,
      );
      counters.eventsImported += delta.imported;
      counters.fingerprintsRegistered += delta.registered;
    },
  );
}

async function importSingleProject(
  ctx: ImportContext,
  rawProject: z.infer<typeof BugsinkProjectItemSchema>,
  counters: ImportCounters,
): Promise<void> {
  const publicKey = await resolveImportedProjectPublicKey(ctx, rawProject);
  if (!ctx.dryRun) {
    await ctx.repo.upsertImportedProject({
      id: rawProject.id,
      slug: rawProject.slug,
      name: rawProject.name,
      publicKey,
      digestedEventCount: rawProject.digested_event_count,
      storedEventCount: rawProject.stored_event_count,
      alertOnNewIssue: rawProject.alert_on_new_issue,
      alertOnRegression: rawProject.alert_on_regression,
    });
  }
  counters.projectsImported += 1;
  counters.releasesImported += await importProjectReleases(ctx, rawProject.id);

  const projectIssues = await importProjectIssues(ctx, rawProject.id);
  counters.issuesImported += projectIssues.length;
  counters.fingerprintsRegistered += projectIssues.length;

  const issuesWithEvents = projectIssues.filter(
    (issue) => issue.stored_event_count > 0,
  );
  for (const issue of issuesWithEvents) {
    await importEventsForIssue(ctx, rawProject.id, issue.id, counters);
  }
}

export async function runBugsinkImport(
  options: RunBugsinkImportOptions,
): Promise<BugsinkImportResult> {
  const startedAt = performance.now();
  const { apiBase, origin } = normalizeBugsinkBaseUrl(options.baseUrl);
  const ctx: ImportContext = {
    apiBase,
    origin,
    token: options.token,
    repo: options.repo,
    dryRun: options.dryRun ?? false,
    concurrency: Math.max(1, Math.min(32, options.concurrency ?? 8)),
    fetchFn: options.fetchFn ?? globalThis.fetch,
    maxPages: options.maxPages ?? 500,
  };

  const listedProjects = await fetchAllBugsinkPages({
    initialUrl: `${ctx.apiBase}/projects/`,
    expectedOrigin: ctx.origin,
    token: ctx.token,
    itemSchema: BugsinkProjectItemSchema,
    fetchFn: ctx.fetchFn,
    maxPages: ctx.maxPages,
  });

  const targetProjects =
    options.projectId === undefined
      ? listedProjects
      : listedProjects.filter((p) => p.id === options.projectId);

  const counters: ImportCounters = {
    projectsImported: 0,
    releasesImported: 0,
    issuesImported: 0,
    eventsImported: 0,
    eventsSkippedExisting: 0,
    fingerprintsRegistered: 0,
  };

  for (const rawProject of targetProjects) {
    await importSingleProject(ctx, rawProject, counters);
  }

  if (!ctx.dryRun) {
    await ctx.repo.reconcileImportedCounts(targetProjects.map((p) => p.id));
  }

  return {
    dryRun: ctx.dryRun,
    ...counters,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
