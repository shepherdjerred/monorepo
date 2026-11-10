import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { BootstrapData, Issue, IssueDetailData } from "./api.ts";
import {
  bootstrapKey,
  cachedIssue,
  forgetIssue,
  invalidateIssue,
  issueKey,
  listsKey,
  patchIssue,
  type CachedIssue,
  type IssuePatch,
  type Outcome,
} from "./cache.ts";
import {
  changePatch,
  changeSlice,
  retriesConflict,
  type IssueChange,
} from "./issue-changes.ts";

/** The server calls an issue edit can make. The browser binds them to tRPC. */
export type IssueApi = {
  update: (input: {
    identifier: string;
    expectedRevision: number;
    title?: string;
    description?: string;
    priority?: number;
    stateName?: string;
    assigneeKey?: string | null;
    projectSlug?: string | null;
    addLabels?: string[];
    removeLabels?: string[];
    archived?: boolean;
    attachmentIds?: string[];
  }) => Promise<Issue>;
  move: (input: {
    identifier: string;
    expectedRevision: number;
    stateId: string;
    beforeId?: string;
    afterId?: string;
  }) => Promise<Issue>;
  vote: (
    identifier: string,
    voted: boolean,
  ) => Promise<{ voteCount: number; viewerVoted: boolean }>;
  detail: (identifier: string) => Promise<IssueDetailData>;
  /** `keepalive` lets the request outlive the page that sent it. */
  remove: (
    input: { identifier: string; expectedRevision: number },
    keepalive: boolean,
  ) => Promise<unknown>;
};

type Session = {
  /** The issue as the server last confirmed it. */
  base: CachedIssue;
  /** Every edit this session applied, so a rollback restores their fields. */
  touched: IssueChange[];
  /** Edits shown optimistically that the server has not confirmed yet. */
  pending: IssueChange[];
  /** Work queued for this issue, running or waiting. */
  queued: number;
  tail: Promise<unknown>;
};

const ConflictSchema = z.object({
  data: z.object({ code: z.literal("CONFLICT") }),
});
/** The keys of the queries that hold issues: one issue, or a list of them. */
const IssueQueryKeySchema = z
  .tuple([z.enum(["issue", "issues"])])
  .rest(z.unknown());
export const isConflict = (error: unknown) =>
  ConflictSchema.safeParse(error).success;

function updateInput(change: IssueChange) {
  switch (change.kind) {
    case "state": {
      return { stateName: change.stateName };
    }
    case "priority": {
      return { priority: change.priority };
    }
    case "assignee": {
      return { assigneeKey: change.assigneeKey };
    }
    case "project": {
      return { projectSlug: change.projectSlug };
    }
    case "label": {
      return change.add
        ? { addLabels: [change.name] }
        : { removeLabels: [change.name] };
    }
    case "title": {
      return { title: change.title };
    }
    case "archive": {
      return { archived: change.archived };
    }
    case "description": {
      return {
        description: change.description,
        attachmentIds: change.attachmentIds,
      };
    }
    case "move":
    case "vote": {
      throw new Error(`A ${change.kind} is not an issue update`);
    }
  }
}

function failure(identifier: string, error: unknown, action: string) {
  if (isConflict(error)) {
    return `${identifier} was changed by someone else, so ${action}. Review it and try again.`;
  }
  return error instanceof Error
    ? `${identifier}: ${error.message}`
    : `${identifier}: ${action}`;
}

/**
 * Optimistic issue edits. Each edit shows at once on every cached copy of the
 * issue, then runs behind the issue's earlier edits against the revision the
 * server last returned, so quick successive edits never race each other.
 */
export function createIssueEdits(deps: {
  client: QueryClient;
  api: IssueApi;
  /** Tell the user an edit or delete was not saved. */
  onError: (message: string, error: unknown) => void;
}) {
  const { client, api } = deps;
  const sessions = new Map<string, Session>();
  const deleting = new Map<string, "waiting" | "sending">();
  const hiddenListeners = new Set<() => void>();
  let hidden: ReadonlySet<string> = new Set();

  function setHidden() {
    hidden = new Set(deleting.keys());
    for (const listener of hiddenListeners) {
      listener();
    }
  }

  function catalog() {
    const bootstrap = client.getQueryData<BootstrapData>(bootstrapKey);
    if (bootstrap === undefined) {
      throw new Error("The workspace is not loaded");
    }
    return bootstrap;
  }

  function open(identifier: string) {
    const known = sessions.get(identifier);
    if (known !== undefined) {
      return known;
    }
    const base = cachedIssue(client, identifier);
    if (base === undefined) {
      throw new Error(`Issue ${identifier} is not loaded`);
    }
    const session: Session = {
      base,
      touched: [],
      pending: [],
      queued: 0,
      tail: Promise.resolve(),
    };
    sessions.set(identifier, session);
    return session;
  }

  /** The confirmed fields of everything touched, then each pending edit. */
  function project(session: Session) {
    let patch: IssuePatch = {};
    for (const change of session.touched) {
      patch = { ...patch, ...changeSlice(session.base, change) };
    }
    if (session.pending.length === 0) {
      return patch;
    }
    const workspace = catalog();
    let current = session.base;
    for (const change of session.pending) {
      const next = changePatch(current, change, workspace);
      current = { ...current, ...next };
      patch = { ...patch, ...next };
    }
    return patch;
  }

  function write(identifier: string, session: Session, server?: Issue) {
    patchIssue(client, identifier, project(session), server);
  }

  /** A refetch that lands mid-edit must not hide the edits still pending. */
  client.getQueryCache().subscribe((event) => {
    if (
      event.type !== "updated" ||
      event.action.type !== "success" ||
      event.action.manual === true
    ) {
      return;
    }
    if (!IssueQueryKeySchema.safeParse(event.query.queryKey).success) {
      return;
    }
    for (const [identifier, session] of sessions) {
      if (session.pending.length > 0) {
        write(identifier, session);
      }
    }
  });

  async function send(
    identifier: string,
    session: Session,
    change: IssueChange,
  ) {
    const expectedRevision = session.base.revision;
    if (change.kind === "vote") {
      const result = await api.vote(identifier, change.voted);
      session.base = { ...session.base, ...result };
      return;
    }
    const server =
      change.kind === "move"
        ? await api.move({
            identifier,
            expectedRevision,
            stateId: change.stateId,
            ...(change.beforeId === undefined
              ? {}
              : { beforeId: change.beforeId }),
            ...(change.afterId === undefined
              ? {}
              : { afterId: change.afterId }),
          })
        : await api.update({
            identifier,
            expectedRevision,
            ...updateInput(change),
          });
    session.base = { ...session.base, ...server };
    return server;
  }

  /** Reload the issue so the next attempt carries its current revision. */
  async function refresh(identifier: string, session: Session) {
    const fresh = await api.detail(identifier);
    client.setQueryData<IssueDetailData>(issueKey(identifier), fresh);
    session.base = fresh;
  }

  /** Run `task`; on a stale revision reload the issue and run it once more. */
  async function withRetry<T>(
    identifier: string,
    session: Session,
    options: { retry: boolean; task: () => Promise<T> },
  ) {
    try {
      return await options.task();
    } catch (error) {
      if (!options.retry || !isConflict(error)) {
        throw error;
      }
    }
    await refresh(identifier, session);
    return options.task();
  }

  function settle(identifier: string, session: Session) {
    session.queued -= 1;
    if (session.queued > 0) {
      return;
    }
    sessions.delete(identifier);
    invalidateIssue(client, identifier);
  }

  /** Queue work behind everything already running for this issue. */
  function enqueue<T>(session: Session, task: () => Promise<T>) {
    session.queued += 1;
    const earlier = session.tail;
    // Queued work reports its own failure, so the chain itself never rejects.
    const run = (async () => {
      await earlier;
      return task();
    })();
    session.tail = run;
    return run;
  }

  async function runEdit(
    identifier: string,
    session: Session,
    change: IssueChange,
  ): Promise<Outcome> {
    try {
      const server = await withRetry(identifier, session, {
        retry: retriesConflict(change),
        task: () => send(identifier, session, change),
      });
      session.pending.splice(session.pending.indexOf(change), 1);
      write(identifier, session, server);
      return { ok: true, value: undefined };
    } catch (error) {
      session.pending.splice(session.pending.indexOf(change), 1);
      write(identifier, session);
      deps.onError(
        failure(identifier, error, "your edit was not saved"),
        error,
      );
      return { ok: false, error };
    } finally {
      settle(identifier, session);
    }
  }

  async function runDelete(identifier: string, session: Session) {
    try {
      await withRetry(identifier, session, {
        retry: true,
        task: () =>
          api.remove(
            { identifier, expectedRevision: session.base.revision },
            false,
          ),
      });
      forgetIssue(client, identifier);
      void client.invalidateQueries({ queryKey: listsKey });
      return { ok: true, value: undefined } as const;
    } catch (error) {
      deps.onError(failure(identifier, error, "it was not deleted"), error);
      return { ok: false, error } as const;
    } finally {
      deleting.delete(identifier);
      setHidden();
      session.queued -= 1;
      if (session.queued <= 0) {
        sessions.delete(identifier);
      }
    }
  }

  /**
   * The page that would report a failure is going away; one that is still
   * open (the tab was only hidden) finds the issue again on its next fetch.
   */
  async function sendNow(identifier: string, expectedRevision: number) {
    try {
      await api.remove({ identifier, expectedRevision }, true);
      forgetIssue(client, identifier);
    } catch {
      void client.invalidateQueries({ queryKey: listsKey });
    }
    deleting.delete(identifier);
    setHidden();
  }

  return {
    /** Apply an edit now and save it in order; resolves once it is settled. */
    edit(identifier: string, change: IssueChange): Promise<Outcome> {
      const session = open(identifier);
      void client.cancelQueries({ queryKey: issueKey(identifier) });
      void client.cancelQueries({ queryKey: listsKey });
      session.touched.push(change);
      session.pending.push(change);
      try {
        write(identifier, session);
      } catch (error) {
        session.touched.pop();
        session.pending.pop();
        throw error;
      }
      return enqueue(session, () => runEdit(identifier, session, change));
    },

    /**
     * Hide an issue as deleted without telling the server yet. The delete is
     * permanent there, so it is only sent by `commitDelete` or `flushDeletes`.
     */
    requestDelete(identifier: string) {
      if (cachedIssue(client, identifier) === undefined) {
        throw new Error(`Issue ${identifier} is not loaded`);
      }
      deleting.set(identifier, "waiting");
      setHidden();
    },

    /** Undo a requested delete; false when it was already sent. */
    cancelDelete(identifier: string) {
      if (deleting.get(identifier) !== "waiting") {
        return false;
      }
      deleting.delete(identifier);
      setHidden();
      return true;
    },

    /** Send a requested delete, behind any edits still saving. */
    async commitDelete(identifier: string): Promise<Outcome> {
      if (deleting.get(identifier) !== "waiting") {
        return { ok: true, value: undefined };
      }
      deleting.set(identifier, "sending");
      const session = open(identifier);
      return enqueue(session, () => runDelete(identifier, session));
    },

    /** The page is going away: send every waiting delete so none is lost. */
    flushDeletes() {
      for (const [identifier, state] of deleting) {
        const issue = cachedIssue(client, identifier);
        if (state !== "waiting" || issue === undefined) {
          continue;
        }
        deleting.set(identifier, "sending");
        void sendNow(identifier, issue.revision);
      }
    },

    /** Identifiers hidden while their delete waits or sends. */
    hidden: {
      subscribe: (listener: () => void) => {
        hiddenListeners.add(listener);
        return () => {
          hiddenListeners.delete(listener);
        };
      },
      get: () => hidden,
    },
  };
}
export type IssueEdits = ReturnType<typeof createIssueEdits>;
