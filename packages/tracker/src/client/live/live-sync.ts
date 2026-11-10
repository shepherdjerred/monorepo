import type { Query, QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type {
  BootstrapData,
  Issue,
  IssueDetailData,
} from "#client/data/api.ts";
import {
  bootstrapKey,
  cachedIssue,
  eventsKey,
  forgetIssue,
  issueKey,
  listsKey,
  patchDetail,
  patchIssue,
} from "#client/data/cache.ts";
import {
  LiveMessageSchema,
  type LiveChange,
  type LiveMessage,
} from "#shared/contract.ts";

/** How long changes gather before one round of refetches. */
const WINDOW_MS = 150;
/**
 * On the page's first connection, queries whose data arrived this shortly
 * before the stream opened were loaded by the same page load.
 */
const FIRST_LOAD_GRACE_MS = 2000;
/** Queries that list events across issues; any change can add to them. */
const activityKeys = new Set(["global-events", "actors", "actor-events"]);
const voteKeys = new Set(["actor-votes"]);

/** One server-sent event: its `event` name and raw `data`. */
type LiveFrame = { event: string; data: unknown };

type ParsedFrame =
  { ok: true; message: LiveMessage } | { ok: false; reason: string };

/** Read one frame against the wire contract. */
export function parseFrame(frame: LiveFrame): ParsedFrame {
  if (typeof frame.data !== "string") {
    return { ok: false, reason: "the frame carries no text" };
  }
  let json: unknown;
  try {
    json = JSON.parse(frame.data);
  } catch {
    return { ok: false, reason: "the frame is not JSON" };
  }
  const parsed = LiveMessageSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: z.prettifyError(parsed.error) };
  }
  if (parsed.data.type !== frame.event) {
    return {
      ok: false,
      reason: `a ${parsed.data.type} message arrived as a ${frame.event} event`,
    };
  }
  return { ok: true, message: parsed.data };
}

/** Refetch shown queries whose data is older than `before`. */
type Resync = { before: number; skipInFlight: boolean };

export type LiveSyncDeps = {
  client: QueryClient;
  /** `issues.byIdentifier` as the issue page queries it. */
  fetchIssue: (identifier: string) => Promise<IssueDetailData>;
  /** Whether this tab sent the request that made a change. */
  isOwn: (requestId: string) => boolean;
  /** A frame broke the wire contract; it is treated as a resync. */
  onBroken: (reason: string) => void;
  /** Another session changed an issue this tab holds; its fresh copy is in. */
  onRemoteIssue?: (identifier: string, actorId: string) => void;
  /** Another session created issues; the shown lists have refetched. */
  onRemoteCreated?: (identifiers: string[]) => void;
  windowMs?: number;
  now?: () => number;
};

/** The detail's fields that a list row also carries. */
function issueRow(detail: IssueDetailData): Issue {
  const {
    comments: _comments,
    attachments: _attachments,
    votes: _votes,
    viewerVoted: _viewerVoted,
    relations: _relations,
    ...row
  } = detail;
  return row;
}

type BatchScope = {
  /** The latest change to each issue, other than deleted ones. */
  touched: Map<string, LiveChange>;
  created: Set<string>;
  forgotten: Set<string>;
  catalog: boolean;
  votes: boolean;
};

const isIssue = (change: LiveChange, action: string) =>
  change.entityType === "issue" && change.action === action;

/** What a batch of changes touched, one entry per issue. */
function batchScope(batch: LiveChange[]): BatchScope {
  const scope: BatchScope = {
    touched: new Map(),
    created: new Set(),
    forgotten: new Set(),
    catalog: false,
    votes: false,
  };
  for (const change of batch) {
    const identifier = change.issueIdentifier;
    scope.votes ||= change.entityType === "vote";
    if (identifier === null) {
      scope.catalog = true;
    } else if (isIssue(change, "deleted")) {
      scope.forgotten.add(identifier);
      scope.touched.delete(identifier);
    } else if (!scope.forgotten.has(identifier)) {
      scope.touched.set(identifier, change);
      if (isIssue(change, "created")) {
        scope.created.add(identifier);
      }
    }
  }
  return scope;
}

const firstKey = (query: Query) => {
  const [key] = query.queryKey;
  return typeof key === "string" ? key : undefined;
};

/**
 * Applies the stream to the query cache. Changes gather for a short window
 * and are deduplicated per issue, so a burst costs one refetch per issue
 * shown and at most one list refetch. Changes this tab made are skipped: the
 * mutation that made them already refetches what it touched.
 *
 * A resync refetches each shown query whose data is older than a cutoff. A
 * resync that opens a connection uses the moment it opened: only data from
 * before then can have missed a change. On the page's first connection, data
 * that arrived up to two seconds before it opened, or is still arriving, came
 * from the same page load, so it is not fetched a second time. Any other
 * resync means changes were dropped, and everything shown refetches.
 */
export function createLiveSync(deps: LiveSyncDeps) {
  const { client } = deps;
  const now = deps.now ?? Date.now;
  const windowMs = deps.windowMs ?? WINDOW_MS;
  let changes: LiveChange[] = [];
  let resync: Resync | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let connection: { openedAt: number; initial: boolean; fresh: boolean } = {
    openedAt: 0,
    initial: false,
    fresh: false,
  };

  function requestResync(next: Resync) {
    resync =
      resync === undefined
        ? next
        : {
            before: Math.max(resync.before, next.before),
            skipInFlight: resync.skipInFlight && next.skipInFlight,
          };
  }

  function refetchShown({ before, skipInFlight }: Resync) {
    return client.invalidateQueries({
      refetchType: "active",
      predicate: (query) =>
        query.state.dataUpdatedAt < before &&
        !(skipInFlight && query.state.fetchStatus === "fetching"),
    });
  }

  function invalidateKeys(keys: Set<string>) {
    return client.invalidateQueries({
      refetchType: "active",
      predicate: (query) => keys.has(firstKey(query) ?? ""),
    });
  }

  async function refreshIssue(identifier: string, change: LiveChange) {
    const history = client.invalidateQueries({
      queryKey: eventsKey(identifier),
      refetchType: "active",
    });
    try {
      const fresh = await deps.fetchIssue(identifier);
      const known = cachedIssue(client, identifier);
      // Forgotten meanwhile, or a newer copy already landed.
      if (known === undefined || known.revision > fresh.revision) {
        return;
      }
      patchDetail(client, identifier, () => fresh);
      patchIssue(client, identifier, {}, issueRow(fresh));
      deps.onRemoteIssue?.(identifier, change.actorId);
    } catch {
      // The issue's own query refetches and reports what went wrong.
      await client.invalidateQueries({ queryKey: issueKey(identifier) });
    }
    await history;
  }

  function unknownActor(batch: LiveChange[]) {
    const actors =
      client.getQueryData<BootstrapData>(bootstrapKey)?.actors ?? [];
    return batch.some(
      (change) => !actors.some((actor) => actor.id === change.actorId),
    );
  }

  async function showCreated(identifiers: string[]) {
    // Every loaded page of a list refetches, so lists refetch once a batch.
    await client.invalidateQueries({
      queryKey: listsKey,
      refetchType: "active",
    });
    deps.onRemoteCreated?.(identifiers);
  }

  async function applyChanges(batch: LiveChange[], scope: BatchScope) {
    const work: Promise<unknown>[] = [
      invalidateKeys(
        scope.votes ? new Set([...activityKeys, ...voteKeys]) : activityKeys,
      ),
    ];
    if (scope.catalog || unknownActor(batch)) {
      work.push(
        client.invalidateQueries({
          queryKey: bootstrapKey,
          refetchType: "active",
        }),
      );
    }
    const appeared: string[] = [];
    for (const [identifier, change] of scope.touched) {
      if (cachedIssue(client, identifier) !== undefined) {
        work.push(refreshIssue(identifier, change));
      } else if (scope.created.has(identifier)) {
        appeared.push(identifier);
      }
    }
    if (appeared.length > 0) {
      work.push(showCreated(appeared));
    }
    await Promise.all(work);
  }

  async function apply(batch: LiveChange[], pending: Resync | undefined) {
    const scope = batchScope(batch);
    for (const identifier of scope.forgotten) {
      forgetIssue(client, identifier);
    }
    // A resync without a cutoff refetches everything shown, changes and all.
    // One that opens a connection leaves recent data, so changes in the same
    // window still apply.
    const everything = pending?.before === Infinity;
    await Promise.all([
      pending === undefined ? undefined : refetchShown(pending),
      everything || batch.length === 0 ? undefined : applyChanges(batch, scope),
    ]);
  }

  async function flush() {
    clearTimeout(timer);
    timer = undefined;
    const batch = changes;
    const pending = resync;
    changes = [];
    resync = undefined;
    await apply(batch, pending);
  }

  return {
    /** The stream opened; `initial` marks the page's first connection. */
    opened(initial: boolean) {
      connection = { openedAt: now(), initial, fresh: true };
    },

    /** Take one frame from the stream. */
    receive(frame: LiveFrame) {
      const parsed = parseFrame(frame);
      const opening = connection.fresh;
      connection.fresh = false;
      if (!parsed.ok) {
        deps.onBroken(parsed.reason);
        requestResync({ before: Infinity, skipInFlight: false });
      } else if (parsed.message.type === "resync") {
        requestResync(
          opening
            ? {
                before:
                  connection.openedAt -
                  (connection.initial ? FIRST_LOAD_GRACE_MS : 0),
                skipInFlight: connection.initial,
              }
            : { before: Infinity, skipInFlight: false },
        );
      } else if (deps.isOwn(parsed.message.requestId)) {
        return;
      } else {
        const { type: _type, ...change } = parsed.message;
        changes.push(change);
      }
      timer ??= setTimeout(() => {
        void flush();
      }, windowMs);
    },

    /** Apply what has gathered now instead of at the end of the window. */
    flush,

    /** Drop what has gathered; the next connection resyncs anyway. */
    dispose() {
      clearTimeout(timer);
      timer = undefined;
      changes = [];
      resync = undefined;
    },
  };
}
