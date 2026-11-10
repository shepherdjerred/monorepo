import { useSyncExternalStore } from "react";
import type { BulkChange } from "#client/data/bulk-changes.ts";
import {
  bulkEdit,
  editIssue,
  loadedIssue,
  selfAssignee,
  workspace,
} from "#client/data/mutations.ts";
import { notify, notifyError } from "#client/ui/toast.tsx";
import { branchName, issueUrl, joinLines } from "./copy-formats.ts";
import { openSearchPicker } from "./search-picker.tsx";
import type { SearchPickerKind } from "./picker-items.tsx";

/**
 * The actions every surface shares — rows, cards, the context menu, the bulk
 * bar, the palette and the shortcuts — over one issue or a selection.
 */
export function applyChange(
  identifiers: readonly string[],
  change: BulkChange,
) {
  const [only, ...rest] = identifiers;
  if (only === undefined) {
    return;
  }
  void (rest.length === 0
    ? editIssue(only, change)
    : bulkEdit(identifiers, change));
}

export function assignToMe(identifiers: readonly string[]) {
  applyChange(identifiers, { kind: "assignee", assigneeKey: selfAssignee() });
}

/** Archive the issues, or bring them back when every one is archived. */
export function toggleArchived(identifiers: readonly string[]) {
  const archived = identifiers.every(
    (identifier) => loadedIssue(identifier).archivedAt !== null,
  );
  applyChange(identifiers, { kind: "archive", archived: !archived });
}

function shared<T>(values: readonly T[]) {
  const [first] = values;
  return values.every((value) => value === first) ? first : undefined;
}

/** Open the searchable picker for a property of these issues. */
export function pickProperty(
  kind: SearchPickerKind,
  identifiers: readonly string[],
  anchor: HTMLElement,
) {
  const issues = identifiers.map((identifier) => loadedIssue(identifier));
  const [first] = issues;
  if (first === undefined) {
    return;
  }
  const team = workspace().teams.find(({ id }) => id === first.teamId);
  const subject =
    identifiers.length === 1
      ? first.identifier
      : `${String(identifiers.length)} issues`;
  const names = issues.map((issue) => issue.labels.map(({ name }) => name));
  const everyLabel = names.flat();
  const all = [...new Set(everyLabel)].filter((name) =>
    names.every((list) => list.includes(name)),
  );
  const selected =
    kind === "assignee"
      ? [shared(issues.map((issue) => issue.assignee?.key ?? ""))]
      : kind === "project"
        ? [shared(issues.map((issue) => issue.project?.slug ?? ""))]
        : all;
  openSearchPicker({
    kind,
    anchor,
    teamId: first.teamId,
    teamKey: team?.key ?? "",
    title: `${{ assignee: "Assignee", labels: "Labels", project: "Project" }[kind]} of ${subject}`,
    selected: selected.flatMap((value) =>
      value === undefined || value === "" ? [] : [value],
    ),
    mixed: [...new Set(everyLabel)].filter((name) => !all.includes(name)),
    pick: (value, add) => {
      if (kind === "assignee") {
        applyChange(identifiers, { kind: "assignee", assigneeKey: value });
      } else if (kind === "project") {
        applyChange(identifiers, { kind: "project", projectSlug: value });
      } else if (value !== null) {
        applyChange(identifiers, { kind: "label", name: value, add });
      }
    },
  });
}

async function copy(text: string, confirmation: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify(confirmation);
  } catch {
    notifyError("The clipboard is not available here");
  }
}

const many = (identifiers: readonly string[], one: string, several: string) =>
  identifiers.length === 1 ? one : `${String(identifiers.length)} ${several}`;

export function copyIds(identifiers: readonly string[]) {
  void copy(
    joinLines(identifiers),
    `Copied ${many(identifiers, identifiers[0] ?? "", "IDs")}`,
  );
}

export function copyLinks(identifiers: readonly string[]) {
  void copy(
    joinLines(
      identifiers.map((identifier) =>
        issueUrl(globalThis.location.origin, identifier),
      ),
    ),
    `Copied ${many(identifiers, "link", "links")}`,
  );
}

export function copyBranchNames(identifiers: readonly string[]) {
  void copy(
    joinLines(
      identifiers.map((identifier) =>
        branchName(identifier, loadedIssue(identifier).title),
      ),
    ),
    `Copied ${many(identifiers, "branch name", "branch names")}`,
  );
}

export function openInNewTab(identifier: string) {
  globalThis.open(`/issues/${identifier}`, "_blank", "noopener");
}

/** Deleting asks first; the request waits here until the dialog answers. */
let deleteRequest: readonly string[] | undefined;
const deleteListeners = new Set<() => void>();
function setDeleteRequest(next: readonly string[] | undefined) {
  deleteRequest = next;
  for (const listener of deleteListeners) {
    listener();
  }
}

export function confirmDelete(identifiers: readonly string[]) {
  setDeleteRequest(identifiers.length === 0 ? undefined : identifiers);
}

export function cancelDelete() {
  setDeleteRequest(undefined);
}

export function useDeleteRequest() {
  return useSyncExternalStore(
    (listener) => {
      deleteListeners.add(listener);
      return () => {
        deleteListeners.delete(listener);
      };
    },
    () => deleteRequest,
  );
}
