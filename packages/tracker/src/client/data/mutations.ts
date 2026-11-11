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

/**
 * Delete an issue. The server cannot restore one, so the issue only
 * disappears here until the Undo toast goes away, and is deleted then.
 */
export function deleteIssue(identifier: string) {
  edits.requestDelete(identifier);
  deleteToasts.set(
    identifier,
    notifyUndo(`${identifier} deleted`, {
      undo: () => {
        deleteToasts.delete(identifier);
        if (edits.cancelDelete(identifier)) {
          notify(`${identifier} restored`);
        } else {
          notifyError(`${identifier} was already deleted`);
        }
      },
      expire: () => {
        deleteToasts.delete(identifier);
        void edits.commitDelete(identifier);
      },
    }),
  );
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
export async function createIssue(input: NewIssue) {
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
  notify(`${issue.identifier} created`);
  return issue;
}
