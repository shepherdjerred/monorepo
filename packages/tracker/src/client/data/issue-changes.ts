import type { BootstrapData, Issue } from "./api.ts";
import type { CachedIssue, IssuePatch } from "./cache.ts";

/** One user-level edit to an issue: the unit that is queued, sent and undone. */
export type IssueChange =
  | { kind: "state"; stateName: string }
  | { kind: "priority"; priority: number }
  | { kind: "assignee"; assigneeKey: string | null }
  | { kind: "project"; projectSlug: string | null }
  | { kind: "label"; name: string; add: boolean }
  | { kind: "title"; title: string }
  | { kind: "archive"; archived: boolean }
  | { kind: "description"; description: string; attachmentIds: string[] }
  | {
      kind: "move";
      stateId: string;
      boardOrder: number;
      beforeId?: string;
      afterId?: string;
    }
  | { kind: "vote"; voted: boolean };

/** The workspace records an edit refers to by name, slug or key. */
export type Catalog = Pick<
  BootstrapData,
  "states" | "labels" | "projects" | "actors"
>;

export const priorities = ["No priority", "Urgent", "High", "Medium", "Low"];

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`The workspace has no ${what}`);
  }
  return value;
}

function labelPatch(
  issue: CachedIssue,
  change: { name: string; add: boolean },
  catalog: Catalog,
): IssuePatch {
  const without = issue.labels.filter(({ name }) => name !== change.name);
  if (!change.add) {
    return { labels: without };
  }
  const label = required(
    catalog.labels.find(
      ({ teamId, name }) => teamId === issue.teamId && name === change.name,
    ),
    `label ${change.name}`,
  );
  return { labels: [...without, label] };
}

function referencePatch(
  issue: CachedIssue,
  change: Extract<IssueChange, { kind: "state" | "assignee" | "project" }>,
  catalog: Catalog,
): IssuePatch {
  if (change.kind === "state") {
    const state = required(
      catalog.states.find(
        ({ teamId, name }) =>
          teamId === issue.teamId && name === change.stateName,
      ),
      `state ${change.stateName}`,
    );
    return { state, stateId: state.id };
  }
  if (change.kind === "assignee") {
    if (change.assigneeKey === null) {
      return { assignee: null, assigneeId: null };
    }
    const assignee = required(
      catalog.actors.find(({ key }) => key === change.assigneeKey),
      `actor ${change.assigneeKey}`,
    );
    return { assignee, assigneeId: assignee.id };
  }
  if (change.projectSlug === null) {
    return { project: null, projectId: null };
  }
  const project = required(
    catalog.projects.find(({ slug }) => slug === change.projectSlug),
    `project ${change.projectSlug}`,
  );
  return { project, projectId: project.id };
}

/** The fields an edit rewrites, given the issue as it stands before the edit. */
export function changePatch(
  issue: CachedIssue,
  change: IssueChange,
  catalog: Catalog,
): IssuePatch {
  switch (change.kind) {
    case "state":
    case "assignee":
    case "project": {
      return referencePatch(issue, change, catalog);
    }
    case "label": {
      return labelPatch(issue, change, catalog);
    }
    case "priority": {
      return { priority: change.priority };
    }
    case "title": {
      return { title: change.title };
    }
    case "description": {
      return { description: change.description };
    }
    case "archive": {
      return {
        archivedAt: change.archived
          ? (issue.archivedAt ?? new Date().toISOString())
          : null,
      };
    }
    case "move": {
      const state = required(
        catalog.states.find(({ id }) => id === change.stateId),
        `state ${change.stateId}`,
      );
      return { state, stateId: state.id, boardOrder: change.boardOrder };
    }
    case "vote": {
      if (issue.viewerVoted === change.voted) {
        return {};
      }
      return {
        voteCount: Math.max(0, issue.voteCount + (change.voted ? 1 : -1)),
        viewerVoted: change.voted,
      };
    }
  }
}

/** The same fields an edit rewrites, read from an issue instead. */
export function changeSlice(
  issue: CachedIssue,
  change: IssueChange,
): IssuePatch {
  switch (change.kind) {
    case "state": {
      return { state: issue.state, stateId: issue.stateId };
    }
    case "assignee": {
      return { assignee: issue.assignee, assigneeId: issue.assigneeId };
    }
    case "project": {
      return { project: issue.project, projectId: issue.projectId };
    }
    case "label": {
      return { labels: issue.labels };
    }
    case "priority": {
      return { priority: issue.priority };
    }
    case "title": {
      return { title: issue.title };
    }
    case "description": {
      return { description: issue.description };
    }
    case "archive": {
      return { archivedAt: issue.archivedAt };
    }
    case "move": {
      return {
        state: issue.state,
        stateId: issue.stateId,
        boardOrder: issue.boardOrder,
      };
    }
    case "vote": {
      return {
        voteCount: issue.voteCount,
        ...(issue.viewerVoted === undefined
          ? {}
          : { viewerVoted: issue.viewerVoted }),
      };
    }
  }
}

/**
 * The edit that puts an issue back as it was, for the edits that offer Undo.
 * A board move is undone by the board, which knows the neighbouring cards.
 */
export function inverseChange(
  issue: CachedIssue,
  change: IssueChange,
): IssueChange | undefined {
  switch (change.kind) {
    case "state": {
      return { kind: "state", stateName: issue.state.name };
    }
    case "priority": {
      return { kind: "priority", priority: issue.priority };
    }
    case "assignee": {
      return { kind: "assignee", assigneeKey: issue.assignee?.key ?? null };
    }
    case "project": {
      return { kind: "project", projectSlug: issue.project?.slug ?? null };
    }
    case "label": {
      return { kind: "label", name: change.name, add: !change.add };
    }
    case "archive": {
      return { kind: "archive", archived: !change.archived };
    }
    case "title":
    case "description":
    case "move":
    case "vote": {
      return undefined;
    }
  }
}

/** Blindly resending a long text over someone else's edit would lose theirs. */
export function retriesConflict(change: IssueChange) {
  return change.kind !== "description";
}

function referenceSummary(
  change: Extract<IssueChange, { kind: "assignee" | "project" | "move" }>,
  catalog: Catalog,
) {
  if (change.kind === "assignee") {
    const name = catalog.actors.find(
      ({ key }) => key === change.assigneeKey,
    )?.name;
    return name === undefined ? "unassigned" : `assigned to ${name}`;
  }
  if (change.kind === "project") {
    const name = catalog.projects.find(
      ({ slug }) => slug === change.projectSlug,
    )?.name;
    return name === undefined ? "removed from its project" : `moved to ${name}`;
  }
  const state = catalog.states.find(({ id }) => id === change.stateId)?.name;
  return `moved to ${state ?? "another column"}`;
}

/** What an edit did, as the sentence a toast shows after the identifier. */
export function changeSummary(change: IssueChange, catalog: Catalog) {
  switch (change.kind) {
    case "state": {
      return `status set to ${change.stateName}`;
    }
    case "priority": {
      return `priority set to ${priorities[change.priority] ?? "none"}`;
    }
    case "assignee":
    case "project":
    case "move": {
      return referenceSummary(change, catalog);
    }
    case "label": {
      return `label ${change.name} ${change.add ? "added" : "removed"}`;
    }
    case "title": {
      return "title updated";
    }
    case "description": {
      return "description saved";
    }
    case "archive": {
      return change.archived ? "archived" : "unarchived";
    }
    case "vote": {
      return change.voted ? "vote added" : "vote removed";
    }
  }
}

/**
 * The cards a card sits between in a column, as `issues.move` wants them:
 * the last card ordered before it and the first ordered after it.
 */
export function boardSlot(
  rows: Issue[],
  card: { id: string; stateId: string; boardOrder: number },
) {
  const column = rows
    .filter(
      (row) =>
        row.stateId === card.stateId &&
        row.id !== card.id &&
        row.archivedAt === null,
    )
    .sort((a, b) => a.boardOrder - b.boardOrder || a.id.localeCompare(b.id));
  const before = column.findLast((row) => row.boardOrder < card.boardOrder);
  const after = column.find((row) => row.boardOrder >= card.boardOrder);
  return {
    ...(before === undefined ? {} : { beforeId: before.id }),
    ...(after === undefined ? {} : { afterId: after.id }),
  };
}

/** The `issues.update` fields that make an edit. */
export function updateInput(change: IssueChange) {
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
