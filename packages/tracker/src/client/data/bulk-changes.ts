import type { Effort, Impact, Urgency } from "#shared/schema.ts";
import type { CachedIssue } from "./cache.ts";
import { localToday } from "#client/due/dates.ts";
import { dueLabel } from "#client/due/due-display.ts";
import {
  effortLabels,
  impactLabels,
  inverseChange,
  updateInput,
  priorities,
  urgencyLabels,
  type Catalog,
  type IssueChange,
  type SizingChange,
} from "./issue-changes.ts";

/** The edits a bulk action can make; a board move needs its own slot. */
export type BulkChange = Extract<
  IssueChange,
  {
    kind:
      | "state"
      | "priority"
      | "priorityAuto"
      | "urgency"
      | "impact"
      | "effort"
      | "assignee"
      | "project"
      | "label"
      | "archive"
      | "due"
      | "parent";
  }
>;
export type IssueEdit = readonly [identifier: string, change: BulkChange];

type BaseBulkChange = Exclude<BulkChange, SizingChange>;

function splitBulkChange(
  change: BulkChange,
): { sizing: SizingChange } | { base: BaseBulkChange } {
  return change.kind === "priority" ||
    change.kind === "priorityAuto" ||
    change.kind === "urgency" ||
    change.kind === "impact" ||
    change.kind === "effort"
    ? { sizing: change }
    : { base: change };
}

function sizingUnchanged(issue: CachedIssue, change: SizingChange) {
  switch (change.kind) {
    case "priority": {
      return (
        issue.priority === change.priority &&
        (change.priorityManual === undefined ||
          issue.priorityManual === change.priorityManual)
      );
    }
    case "priorityAuto": {
      return !issue.priorityManual;
    }
    case "urgency": {
      return issue.urgency === change.urgency;
    }
    case "impact": {
      return issue.impact === change.impact;
    }
    case "effort": {
      return issue.effort === change.effort;
    }
  }
}

/** True when applying the change would leave the issue as it is. */
export function changesNothing(issue: CachedIssue, change: BulkChange) {
  const split = splitBulkChange(change);
  if ("sizing" in split) return sizingUnchanged(issue, split.sizing);
  const { base } = split;
  switch (base.kind) {
    case "state": {
      return issue.state.name === base.stateName;
    }
    case "assignee": {
      return (issue.assignee?.key ?? null) === base.assigneeKey;
    }
    case "project": {
      return (issue.project?.slug ?? null) === base.projectSlug;
    }
    case "label": {
      return issue.labels.some(({ name }) => name === base.name) === base.add;
    }
    case "archive": {
      return (issue.archivedAt !== null) === base.archived;
    }
    case "due": {
      return issue.dueDate === base.dueDate;
    }
    case "parent": {
      return (issue.parent?.identifier ?? null) === base.parentIdentifier;
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
    case "priorityAuto":
    case "urgency":
    case "impact":
    case "effort":
    case "assignee":
    case "project":
    case "label":
    case "archive":
    case "due":
    case "parent": {
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

/**
 * Edits grouped by identical change, in first-seen order, so each group can
 * be sent as one bulk request.
 */
export function groupEdits(edits: readonly IssueEdit[]) {
  const groups = new Map<
    string,
    { change: BulkChange; identifiers: string[] }
  >();
  for (const [identifier, change] of edits) {
    const key = JSON.stringify(change);
    const group = groups.get(key) ?? { change, identifiers: [] };
    group.identifiers.push(identifier);
    groups.set(key, group);
  }
  return [...groups.values()];
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

function bulkSizingSummary(change: SizingChange, issues: string) {
  switch (change.kind) {
    case "priority": {
      return `Set ${issues} to ${priorities[change.priority] ?? "No priority"}`;
    }
    case "priorityAuto": {
      return `Reset priority to auto on ${issues}`;
    }
    case "urgency": {
      return change.urgency === null
        ? `Cleared urgency of ${issues}`
        : `Set urgency of ${issues} to ${urgencyLabels[change.urgency]}`;
    }
    case "impact": {
      return change.impact === null
        ? `Cleared impact of ${issues}`
        : `Set impact of ${issues} to ${impactLabels[change.impact]}`;
    }
    case "effort": {
      return change.effort === null
        ? `Cleared effort of ${issues}`
        : `Set effort of ${issues} to ${effortLabels[change.effort]}`;
    }
  }
}

/** The toast that confirms a bulk action, e.g. "Set 12 issues to In progress". */
export function bulkSummary(
  change: BulkChange,
  count: number,
  catalog: Catalog,
) {
  const issues = issuesWord(count);
  const split = splitBulkChange(change);
  if ("sizing" in split) return bulkSizingSummary(split.sizing, issues);
  const { base } = split;
  switch (base.kind) {
    case "state": {
      return `Set ${issues} to ${base.stateName}`;
    }
    case "assignee": {
      const name = catalog.actors.find(
        ({ key }) => key === base.assigneeKey,
      )?.name;
      return name === undefined
        ? `Unassigned ${issues}`
        : `Assigned ${issues} to ${name}`;
    }
    case "project": {
      const name = catalog.projects.find(
        ({ slug }) => slug === base.projectSlug,
      )?.name;
      return name === undefined
        ? `Removed ${issues} from their project`
        : `Moved ${issues} to ${name}`;
    }
    case "label": {
      return base.add
        ? `Added ${base.name} to ${issues}`
        : `Removed ${base.name} from ${issues}`;
    }
    case "archive": {
      return `${base.archived ? "Archived" : "Unarchived"} ${issues}`;
    }
    case "due": {
      return base.dueDate === null
        ? `Cleared the due date of ${issues}`
        : `Set ${issues} due ${dueLabel(base.dueDate, localToday()).toLowerCase()}`;
    }
    case "parent": {
      return base.parentIdentifier === null
        ? `Removed the parent of ${issues}`
        : `Moved ${issues} under ${base.parentIdentifier}`;
    }
  }
}

/** The fields one `issues.bulkUpdate` sets on every issue it names. */
export type BulkPatch = {
  stateName?: string;
  priority?: number;
  priorityManual?: boolean;
  urgency?: Urgency | null;
  impact?: Impact | null;
  effort?: Effort | null;
  assigneeKey?: string | null;
  projectSlug?: string | null;
  addLabels?: string[];
  removeLabels?: string[];
  archived?: boolean;
  dueDate?: string | null;
  parentIdentifier?: string | null;
};

/** A bulk change as the fields `issues.bulkUpdate` sets on every issue. */
export function bulkPatch(change: BulkChange): BulkPatch {
  switch (change.kind) {
    case "state":
    case "priority":
    case "priorityAuto":
    case "urgency":
    case "impact":
    case "effort":
    case "assignee":
    case "project":
    case "label":
    case "archive":
    case "due":
    case "parent": {
      return updateInput(change);
    }
  }
}
