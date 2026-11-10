import { api, keepaliveApi, queryClient, type BootstrapData } from "./api.ts";
import {
  bootstrapKey,
  cachedIssue,
  cachedRows,
  issueKey,
  listsKey,
  type Outcome,
} from "./cache.ts";
import { currentActor } from "./identity.ts";
import {
  boardSlot,
  changeSummary,
  inverseChange,
  type IssueChange,
} from "./issue-changes.ts";
import { createIssueEdits, failureReason } from "./issue-edits.ts";
import {
  bulkSummary,
  planBulk,
  type BulkChange,
  type IssueEdit,
} from "./bulk-changes.ts";
import {
  dismissToast,
  notify,
  notifyError,
  notifyUndo,
} from "#client/ui/toast.tsx";

const edits = createIssueEdits({
  client: queryClient,
  api: {
    update: (input) =>
      api.issues.update.mutate({ actor: currentActor(), ...input }),
    move: (input) =>
      api.issues.move.mutate({ actor: currentActor(), ...input }),
    vote: (identifier, voted) =>
      voted
        ? api.votes.cast.mutate({ actor: currentActor(), identifier })
        : api.votes.remove.mutate({ actor: currentActor(), identifier }),
    detail: (identifier) =>
      api.issues.byIdentifier.query({
        identifier,
        viewerActorKey: currentActor().key,
      }),
    remove: (input, keepalive) =>
      (keepalive ? keepaliveApi : api).issues.delete.mutate({
        actor: currentActor(),
        ...input,
      }),
  },
  onError: (message) => {
    notifyError(message);
  },
});

/** The workspace catalog; every screen that can mutate has loaded it. */
export function workspace() {
  const bootstrap = queryClient.getQueryData<BootstrapData>(bootstrapKey);
  if (bootstrap === undefined) {
    throw new Error("The workspace is not loaded");
  }
  return bootstrap;
}

/** An issue the screen is showing, and so has cached. */
export function loadedIssue(identifier: string) {
  const issue = cachedIssue(queryClient, identifier);
  if (issue === undefined) {
    throw new Error(`Issue ${identifier} is not loaded`);
  }
  return issue;
}

/**
 * The server records an actor on their first mutation. Until the workspace
 * lists them they cannot be assigned, so that one mutation refetches it.
 */
export function noteActor() {
  const { key } = currentActor();
  if (!workspace().actors.some((actor) => actor.key === key)) {
    void queryClient.invalidateQueries({ queryKey: bootstrapKey });
  }
}

/** Save an edit with Undo on offer from the moment it shows. */
async function saveWithUndo(
  saving: Promise<Outcome>,
  title: string,
  undo: () => Promise<Outcome>,
) {
  const toast = notifyUndo(title, {
    undo: () => {
      void undo();
    },
  });
  const outcome = await saving;
  if (outcome.ok) {
    noteActor();
  } else {
    dismissToast(toast);
  }
  return outcome;
}

async function saveThenConfirm(saving: Promise<Outcome>, title: string) {
  const outcome = await saving;
  if (outcome.ok) {
    noteActor();
    notify(title);
  }
  return outcome;
}

/**
 * Edit one field of an issue. The change shows at once everywhere the issue
 * is cached; a failure puts it back and says why. Edits that can be reversed
 * (status, priority, assignee, project, labels, archive) offer Undo.
 */
export function editIssue(
  identifier: string,
  change: Exclude<IssueChange, { kind: "move" }>,
): Promise<Outcome> {
  const inverse = inverseChange(loadedIssue(identifier), change);
  const title = `${identifier} ${changeSummary(change, workspace())}`;
  const saving = edits.edit(identifier, change);
  return inverse === undefined
    ? saveThenConfirm(saving, title)
    : saveWithUndo(saving, title, () =>
        saveThenConfirm(
          edits.edit(identifier, inverse),
          `${identifier} change undone`,
        ),
      );
}

/** Name the issues an action failed for, once, with the first reason. */
function reportFailures(
  outcomes: readonly (readonly [string, Outcome])[],
  what: string,
) {
  const failed = outcomes.flatMap(([identifier, outcome]) =>
    outcome.ok ? [] : [{ identifier, error: outcome.error }],
  );
  const [first] = failed;
  if (first !== undefined) {
    notifyError(
      `${what}: ${failed.map(({ identifier }) => identifier).join(", ")} (${failureReason(first.error)})`,
    );
  }
  return failed.length;
}

/**
 * Edit many issues at once. Each edit is saved like a single one, in
 * parallel, without its own toast: one toast confirms them all, one Undo
 * takes back every edit that was not already rolled back, and one error
 * names the issues that could not be saved.
 */
export async function editIssues(
  changes: readonly IssueEdit[],
  summary: string,
): Promise<Outcome[]> {
  const inverses = changes.map(([identifier, change]) => {
    const inverse = inverseChange(loadedIssue(identifier), change);
    if (inverse === undefined) {
      throw new Error(`A ${change.kind} change cannot be undone`);
    }
    return [identifier, inverse] as const;
  });
  const failed = new Set<string>();
  const saving = Promise.all(
    changes.map(async ([identifier, change]) => {
      const outcome = await edits.edit(identifier, change, { report: false });
      if (!outcome.ok) {
        failed.add(identifier);
      }
      return [identifier, outcome] as const;
    }),
  );
  const toast = notifyUndo(summary, {
    undo: () => {
      void (async () => {
        const undone = await Promise.all(
          inverses
            .filter(([identifier]) => !failed.has(identifier))
            .map(
              async ([identifier, inverse]) =>
                [
                  identifier,
                  await edits.edit(identifier, inverse, { report: false }),
                ] as const,
            ),
        );
        if (reportFailures(undone, "Not undone") === 0) {
          notify(`Undone: ${summary}`);
        }
      })();
    },
  });
  const outcomes = await saving;
  const failures = reportFailures(outcomes, "Not saved");
  if (failures === outcomes.length) {
    dismissToast(toast);
  } else {
    noteActor();
  }
  return outcomes.map(([, outcome]) => outcome);
}

/**
 * Apply one change to several issues: those it would not alter are skipped,
 * and the toast counts every issue the action was asked about.
 */
export function bulkEdit(identifiers: readonly string[], change: BulkChange) {
  const summary = bulkSummary(change, identifiers.length, workspace());
  const { changes } = planBulk(
    identifiers.map((identifier) => loadedIssue(identifier)),
    change,
  );
  if (changes.length === 0) {
    notify(summary);
    return Promise.resolve([]);
  }
  return editIssues(changes, summary);
}

/**
 * The browser's actor only joins the workspace with its first mutation, so
 * until then it is added here and can be assigned straight away.
 */
export function selfAssignee() {
  const actor = currentActor();
  if (!workspace().actors.some(({ key }) => key === actor.key)) {
    const now = new Date().toISOString();
    queryClient.setQueryData<BootstrapData>(bootstrapKey, (data) =>
      data === undefined
        ? data
        : {
            ...data,
            actors: [
              ...data.actors,
              {
                id: `optimistic-${actor.key}`,
                key: actor.key,
                kind: actor.kind,
                name: actor.name,
                firstSeenAt: now,
                lastSeenAt: now,
                seenCount: 0,
                firstMetadata: actor.metadata,
                metadata: actor.metadata,
              },
            ],
          },
    );
  }
  return actor.key;
}

/** Move a card on the board; Undo returns it to the slot it left. */
export function moveIssue(
  identifier: string,
  target: {
    stateId: string;
    boardOrder: number;
    beforeId?: string;
    afterId?: string;
  },
): Promise<Outcome> {
  const { id, stateId, boardOrder } = loadedIssue(identifier);
  const change: IssueChange = { kind: "move", ...target };
  return saveWithUndo(
    edits.edit(identifier, change),
    `${identifier} ${changeSummary(change, workspace())}`,
    () =>
      saveThenConfirm(
        edits.edit(identifier, {
          kind: "move",
          stateId,
          boardOrder,
          ...boardSlot(cachedRows(queryClient), { id, stateId, boardOrder }),
        }),
        `${identifier} move undone`,
      ),
  );
}

const deleteToasts = new Map<string, string>();

const countOf = (identifiers: readonly string[]) =>
  identifiers.length === 1
    ? (identifiers[0] ?? "")
    : `${String(identifiers.length)} issues`;

/**
 * Delete issues. The server cannot restore one, so they only disappear here
 * until the one Undo toast goes away, and are deleted then.
 */
export function deleteIssues(identifiers: readonly string[]) {
  for (const identifier of identifiers) {
    edits.requestDelete(identifier);
  }
  const key = identifiers.join(" ");
  deleteToasts.set(
    key,
    notifyUndo(`${countOf(identifiers)} deleted`, {
      undo: () => {
        deleteToasts.delete(key);
        const gone = identifiers.filter(
          (identifier) => !edits.cancelDelete(identifier),
        );
        if (gone.length === 0) {
          notify(`${countOf(identifiers)} restored`);
        } else {
          notifyError(
            `${gone.join(", ")} ${gone.length === 1 ? "was" : "were"} already deleted`,
          );
        }
      },
      expire: () => {
        deleteToasts.delete(key);
        for (const identifier of identifiers) {
          void edits.commitDelete(identifier);
        }
      },
    }),
  );
}

export function deleteIssue(identifier: string) {
  deleteIssues([identifier]);
}

/**
 * A hidden tab may never come back, and its toast timers stand still, so
 * waiting deletes are sent now, in requests that outlive the page.
 */
function flushDeletes() {
  edits.flushDeletes();
  for (const toast of deleteToasts.values()) {
    dismissToast(toast);
  }
}
globalThis.addEventListener("pagehide", flushDeletes);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushDeletes();
  }
});

/** Subscription to the issues hidden while their delete can be undone. */
export const hiddenIssues = edits.hidden;

type NewIssue = Omit<Parameters<typeof api.issues.create.mutate>[0], "actor">;

/**
 * Create an issue. Its identifier is the server's to assign, so nothing shows
 * before the answer; the answer then seeds the issue page and the lists.
 */
export async function createIssue(
  input: NewIssue,
  view?: (identifier: string) => void,
) {
  const issue = await api.issues.create.mutate({
    actor: currentActor(),
    ...input,
  });
  if ((input.attachmentIds ?? []).length === 0) {
    queryClient.setQueryData(issueKey(issue.identifier), {
      ...issue,
      comments: [],
      attachments: [],
      votes: [],
      viewerVoted: false,
      relations: [],
    });
  }
  void queryClient.invalidateQueries({ queryKey: listsKey });
  noteActor();
  notify(
    `${issue.identifier} created`,
    view === undefined
      ? undefined
      : {
          label: "Open",
          run: () => {
            view(issue.identifier);
          },
        },
  );
  return issue;
}
