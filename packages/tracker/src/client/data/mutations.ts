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
import { createIssueEdits } from "./issue-edits.ts";
import {
  bulkSummary,
  groupEdits,
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
import { feedback } from "#client/feedback/index.ts";
import { editOutcome } from "#client/feedback/policy.ts";
import { glideRows, leave, settleStatus } from "#client/feedback/motion.ts";

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
    bulkUpdate: (input) =>
      api.issues.bulkUpdate.mutate({ actor: currentActor(), ...input }),
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

/**
 * Acknowledge an edit the moment it shows, once however many issues it
 * touched: a sound and a buzz for its outcome, a settling status icon, rows
 * that glide to their new places, and rows that fade out when an archive
 * takes them off the list.
 */
function acknowledge(
  identifiers: readonly string[],
  change: Exclude<IssueChange, { kind: "move" }>,
) {
  const [first] = identifiers;
  if (first === undefined) {
    return;
  }
  const { teamId } = loadedIssue(first);
  const stateType =
    change.kind === "state"
      ? workspace().states.find(
          (state) => state.teamId === teamId && state.name === change.stateName,
        )?.type
      : undefined;
  const outcome = editOutcome(change.kind, stateType);
  if (outcome !== undefined) {
    feedback(outcome);
  }
  // An edit can move the row: to the top of a list ordered by update, or
  // into another group. It glides there rather than jumping.
  glideRows();
  if (change.kind === "state") {
    settleStatus(identifiers);
  }
  if (change.kind === "archive" && change.archived) {
    leave(identifiers);
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
  acknowledge([identifier], change);
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

const reason = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";

/**
 * Take back a bulk edit. The issues can have had different values before
 * it, so the inverse edits are grouped by identical change and each group is
 * one `issues.bulkUpdate`: the undo is atomic within a group, not across
 * groups, and a group that fails is reported on its own.
 */
async function undoBulk(inverses: readonly IssueEdit[], summary: string) {
  const outcomes = await Promise.all(
    groupEdits(inverses).map(({ change, identifiers }) =>
      edits.bulk(identifiers, change),
    ),
  );
  const failures = outcomes.flatMap((outcome) =>
    outcome.ok ? [] : [reason(outcome.error)],
  );
  if (failures.length === 0) {
    notify(`Undone: ${summary}`);
  } else {
    notifyError(`Not undone: ${failures.join(" ")}`);
  }
}

/**
 * Apply one change to several issues in one atomic request: every issue
 * changes at once on screen, the server saves all of them or none, and one
 * toast confirms them with one Undo. Issues the change would not alter are
 * left out; the toast counts every issue the action was asked about.
 */
export async function bulkEdit(
  identifiers: readonly string[],
  change: BulkChange,
): Promise<Outcome> {
  const summary = bulkSummary(change, identifiers.length, workspace());
  const { changes, inverses } = planBulk(
    identifiers.map((identifier) => loadedIssue(identifier)),
    change,
  );
  if (changes.length === 0) {
    notify(summary);
    return { ok: true, value: undefined };
  }
  acknowledge(
    changes.map(([identifier]) => identifier),
    change,
  );
  let failed = false;
  const toast = notifyUndo(summary, {
    undo: () => {
      if (!failed) {
        void undoBulk(inverses, summary);
      }
    },
  });
  const outcome = await edits.bulk(
    changes.map(([identifier]) => identifier),
    change,
  );
  if (outcome.ok) {
    noteActor();
  } else {
    failed = true;
    dismissToast(toast);
    // The server's message names the issues that stopped the edit.
    notifyError(`Not saved: ${reason(outcome.error)}`);
  }
  return outcome;
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
  feedback("destructive");
  leave(identifiers);
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
      children: [],
    });
  }
  void queryClient.invalidateQueries({ queryKey: listsKey });
  if (input.parentIdentifier !== undefined && input.parentIdentifier !== null) {
    void queryClient.invalidateQueries({
      queryKey: issueKey(input.parentIdentifier),
    });
  }
  noteActor();
  feedback("create");
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
