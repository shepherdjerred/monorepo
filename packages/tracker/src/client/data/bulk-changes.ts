import type { CachedIssue } from "./cache.ts";
import {
  inverseChange,
  priorities,
  type Catalog,
  type IssueChange,
} from "./issue-changes.ts";

/** The edits a bulk action can make; a board move needs its own slot. */
export type BulkChange = Extract<
  IssueChange,
  { kind: "state" | "priority" | "assignee" | "project" | "label" | "archive" }
>;
export type IssueEdit = readonly [identifier: string, change: BulkChange];

/** True when applying the change would leave the issue as it is. */
export function changesNothing(issue: CachedIssue, change: BulkChange) {
  switch (change.kind) {
    case "state": {
      return issue.state.name === change.stateName;
    }
    case "priority": {
      return issue.priority === change.priority;
    }
    case "assignee": {
      return (issue.assignee?.key ?? null) === change.assigneeKey;
    }
    case "project": {
      return (issue.project?.slug ?? null) === change.projectSlug;
    }
    case "label": {
      return (
        issue.labels.some(({ name }) => name === change.name) === change.add
      );
    }
    case "archive": {
      return (issue.archivedAt !== null) === change.archived;
    }
  }
}

/**
 * The per-issue edits a bulk action sends, and the edits that take each one
 * back. Issues the change would not alter are left out of both, so Undo
 * never touches an issue the action did not.
 */
export function planBulk(issues: readonly CachedIssue[], change: BulkChange) {
  const changes: IssueEdit[] = [];
  const inverses: IssueEdit[] = [];
  for (const issue of issues) {
    if (changesNothing(issue, change)) {
      continue;
    }
    changes.push([issue.identifier, change]);
    inverses.push([issue.identifier, bulkInverse(issue, change)]);
  }
  return { changes, inverses };
}

function bulkInverse(issue: CachedIssue, change: BulkChange): BulkChange {
  const inverse = inverseChange(issue, change);
  if (inverse === undefined) {
    throw new Error(`A ${change.kind} change has no inverse`);
  }
  switch (inverse.kind) {
    case "state":
    case "priority":
    case "assignee":
    case "project":
    case "label":
    case "archive": {
      return inverse;
    }
    case "title":
    case "description":
    case "move":
    case "vote": {
      throw new Error(`A ${change.kind} change is undone by a ${inverse.kind}`);
    }
  }
}

/** A label toggled on many issues: added unless every one has it already. */
export function bulkLabelChange(
  issues: readonly CachedIssue[],
  name: string,
): BulkChange {
  const everyone = issues.every((issue) =>
    issue.labels.some((label) => label.name === name),
  );
  return { kind: "label", name, add: !everyone };
}

const issuesWord = (count: number) =>
  count === 1 ? "1 issue" : `${String(count)} issues`;

/** The toast that confirms a bulk action, e.g. "Set 12 issues to In progress". */
export function bulkSummary(
  change: BulkChange,
  count: number,
  catalog: Catalog,
) {
  const issues = issuesWord(count);
  switch (change.kind) {
    case "state": {
      return `Set ${issues} to ${change.stateName}`;
    }
    case "priority": {
      return `Set ${issues} to ${priorities[change.priority] ?? "No priority"}`;
    }
    case "assignee": {
      const name = catalog.actors.find(
        ({ key }) => key === change.assigneeKey,
      )?.name;
      return name === undefined
        ? `Unassigned ${issues}`
        : `Assigned ${issues} to ${name}`;
    }
    case "project": {
      const name = catalog.projects.find(
        ({ slug }) => slug === change.projectSlug,
      )?.name;
      return name === undefined
        ? `Removed ${issues} from their project`
        : `Moved ${issues} to ${name}`;
    }
    case "label": {
      return change.add
        ? `Added ${change.name} to ${issues}`
        : `Removed ${change.name} from ${issues}`;
    }
    case "archive": {
      return `${change.archived ? "Archived" : "Unarchived"} ${issues}`;
    }
  }
}
