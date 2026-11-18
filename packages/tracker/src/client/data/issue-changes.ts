import { resolveIssuePriority } from "#domain/issue.ts";
import type { Effort, Impact, Urgency } from "#shared/schema.ts";
import type { BootstrapData, Issue } from "./api.ts";
import type { CachedIssue, IssuePatch } from "./cache.ts";
import { localToday } from "#client/due/dates.ts";
import { dueLabel } from "#client/due/due-display.ts";

/** One user-level edit to an issue: the unit that is queued, sent and undone. */
export type IssueChange =
  | { kind: "state"; stateName: string }
  | { kind: "priority"; priority: number; priorityManual?: boolean }
  | { kind: "priorityAuto" }
  | { kind: "urgency"; urgency: Urgency | null }
  | { kind: "impact"; impact: Impact | null }
  | { kind: "effort"; effort: Effort | null }
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
  | { kind: "vote"; voted: boolean }
  | { kind: "parent"; parentIdentifier: string | null }
  | { kind: "due"; dueDate: string | null };

export type SizingChange = Extract<
  IssueChange,
  { kind: "priority" | "priorityAuto" | "urgency" | "impact" | "effort" }
>;
type BaseChange = Exclude<IssueChange, SizingChange>;

function splitIssueChange(
  change: IssueChange,
): { sizing: SizingChange } | { base: BaseChange } {
  return change.kind === "priority" ||
    change.kind === "priorityAuto" ||
    change.kind === "urgency" ||
    change.kind === "impact" ||
    change.kind === "effort"
    ? { sizing: change }
    : { base: change };
}

/** The workspace records an edit refers to by name, slug or key. */
export type Catalog = Pick<
  BootstrapData,
  "states" | "labels" | "projects" | "actors"
> & {
  issue?: (identifier: string) => Pick<Issue, "id" | "title"> | undefined;
};

export const priorities = ["No priority", "Urgent", "High", "Medium", "Low"];
const levelLabels = { high: "High", medium: "Medium", low: "Low" } as const;
export const urgencyLabels: Record<Urgency, string> = levelLabels;
export const impactLabels: Record<Impact, string> = levelLabels;
export const effortLabels: Record<Effort, string> = {
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
};

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`The workspace has no ${what}`);
  return value;
}

function labelPatch(
  issue: CachedIssue,
  change: { name: string; add: boolean },
  catalog: Catalog,
): IssuePatch {
  const without = issue.labels.filter(({ name }) => name !== change.name);
  if (!change.add) return { labels: without };
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
  change: Extract<BaseChange, { kind: "state" | "assignee" | "project" }>,
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
    if (change.assigneeKey === null)
      return { assignee: null, assigneeId: null };
    const assignee = required(
      catalog.actors.find(({ key }) => key === change.assigneeKey),
      `actor ${change.assigneeKey}`,
    );
    return { assignee, assigneeId: assignee.id };
  }
  if (change.projectSlug === null) return { project: null, projectId: null };
  const project = required(
    catalog.projects.find(({ slug }) => slug === change.projectSlug),
    `project ${change.projectSlug}`,
  );
  return { project, projectId: project.id };
}

function parentPatch(
  issue: CachedIssue,
  parentIdentifier: string | null,
  catalog: Catalog,
): IssuePatch {
  if (parentIdentifier === null) return { parent: null, parentId: null };
  if (issue.parent?.identifier === parentIdentifier) {
    return { parent: issue.parent, parentId: issue.parentId };
  }
  const known = catalog.issue?.(parentIdentifier);
  return {
    parent: { identifier: parentIdentifier, title: known?.title ?? "" },
    parentId: known?.id ?? `optimistic-${parentIdentifier}`,
  };
}

function sizingMeta(
  issue: CachedIssue,
  change: SizingChange,
): { patch: IssuePatch; slice: IssuePatch; inverse: SizingChange } {
  const priority = {
    priority: issue.priority,
    priorityManual: issue.priorityManual,
  };
  const pinInverse: SizingChange = { kind: "priority", ...priority };
  switch (change.kind) {
    case "priority": {
      return {
        patch: resolveIssuePriority(issue, change),
        slice: priority,
        inverse: pinInverse,
      };
    }
    case "priorityAuto": {
      return {
        patch: resolveIssuePriority(issue, { priorityManual: false }),
        slice: priority,
        inverse: pinInverse,
      };
    }
    case "urgency": {
      return {
        patch: {
          urgency: change.urgency,
          ...resolveIssuePriority(issue, { urgency: change.urgency }),
        },
        slice: { urgency: issue.urgency, ...priority },
        inverse: { kind: "urgency", urgency: issue.urgency },
      };
    }
    case "impact": {
      return {
        patch: {
          impact: change.impact,
          ...resolveIssuePriority(issue, { impact: change.impact }),
        },
        slice: { impact: issue.impact, ...priority },
        inverse: { kind: "impact", impact: issue.impact },
      };
    }
    case "effort": {
      return {
        patch: { effort: change.effort },
        slice: { effort: issue.effort },
        inverse: { kind: "effort", effort: issue.effort },
      };
    }
  }
}

/** The fields an edit rewrites, given the issue as it stands before the edit. */
export function changePatch(
  issue: CachedIssue,
  change: IssueChange,
  catalog: Catalog,
): IssuePatch {
  const split = splitIssueChange(change);
  if ("sizing" in split) return sizingMeta(issue, split.sizing).patch;
  const { base } = split;
  switch (base.kind) {
    case "state":
    case "assignee":
    case "project": {
      return referencePatch(issue, base, catalog);
    }
    case "label": {
      return labelPatch(issue, base, catalog);
    }
    case "title": {
      return { title: base.title };
    }
    case "description": {
      return { description: base.description };
    }
    case "archive": {
      return {
        archivedAt: base.archived
          ? (issue.archivedAt ?? new Date().toISOString())
          : null,
      };
    }
    case "move": {
      const state = required(
        catalog.states.find(({ id }) => id === base.stateId),
        `state ${base.stateId}`,
      );
      return { state, stateId: state.id, boardOrder: base.boardOrder };
    }
    case "parent": {
      return parentPatch(issue, base.parentIdentifier, catalog);
    }
    case "due": {
      return { dueDate: base.dueDate };
    }
    case "vote": {
      if (issue.viewerVoted === base.voted) return {};
      const voteCount = Math.max(0, issue.voteCount + (base.voted ? 1 : -1));
      return {
        voteCount,
        viewerVoted: base.voted,
        ...resolveIssuePriority(issue, { voteCount }),
      };
    }
  }
}

const baseSlices: Record<
  BaseChange["kind"],
  (issue: CachedIssue) => IssuePatch
> = {
  state: (i) => ({ state: i.state, stateId: i.stateId }),
  assignee: (i) => ({ assignee: i.assignee, assigneeId: i.assigneeId }),
  project: (i) => ({ project: i.project, projectId: i.projectId }),
  label: (i) => ({ labels: i.labels }),
  title: (i) => ({ title: i.title }),
  description: (i) => ({ description: i.description }),
  archive: (i) => ({ archivedAt: i.archivedAt }),
  move: (i) => ({
    state: i.state,
    stateId: i.stateId,
    boardOrder: i.boardOrder,
  }),
  parent: (i) => ({ parent: i.parent, parentId: i.parentId }),
  due: (i) => ({ dueDate: i.dueDate }),
  vote: (i) => ({
    voteCount: i.voteCount,
    priority: i.priority,
    priorityManual: i.priorityManual,
    ...(i.viewerVoted === undefined ? {} : { viewerVoted: i.viewerVoted }),
  }),
};

/** The same fields an edit rewrites, read from an issue instead. */
export function changeSlice(
  issue: CachedIssue,
  change: IssueChange,
): IssuePatch {
  const split = splitIssueChange(change);
  return "sizing" in split
    ? sizingMeta(issue, split.sizing).slice
    : baseSlices[split.base.kind](issue);
}

const baseInverses: Partial<
  Record<BaseChange["kind"], (issue: CachedIssue) => IssueChange>
> = {
  state: (i) => ({ kind: "state", stateName: i.state.name }),
  assignee: (i) => ({ kind: "assignee", assigneeKey: i.assignee?.key ?? null }),
  project: (i) => ({ kind: "project", projectSlug: i.project?.slug ?? null }),
  parent: (i) => ({
    kind: "parent",
    parentIdentifier: i.parent?.identifier ?? null,
  }),
  due: (i) => ({ kind: "due", dueDate: i.dueDate }),
};

/** The edit that puts an issue back as it was, for the edits that offer Undo. */
export function inverseChange(
  issue: CachedIssue,
  change: IssueChange,
): IssueChange | undefined {
  const split = splitIssueChange(change);
  if ("sizing" in split) return sizingMeta(issue, split.sizing).inverse;
  const { base } = split;
  if (base.kind === "label") {
    return { kind: "label", name: base.name, add: !base.add };
  }
  return base.kind === "archive"
    ? { kind: "archive", archived: !base.archived }
    : baseInverses[base.kind]?.(issue);
}

export const retriesConflict = (change: IssueChange) =>
  change.kind !== "description";

function referenceSummary(
  change: Extract<BaseChange, { kind: "assignee" | "project" | "move" }>,
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

function sizingSummary(change: SizingChange, issue: CachedIssue | undefined) {
  switch (change.kind) {
    case "priority": {
      return `priority set to ${priorities[change.priority] ?? "none"}`;
    }
    case "priorityAuto": {
      if (issue === undefined) return "priority set to auto";
      const { priority } = resolveIssuePriority(issue, {
        priorityManual: false,
      });
      return `priority set to auto (${priorities[priority] ?? "none"})`;
    }
    case "urgency": {
      return change.urgency === null
        ? "urgency cleared"
        : `urgency set to ${urgencyLabels[change.urgency]}`;
    }
    case "impact": {
      return change.impact === null
        ? "impact cleared"
        : `impact set to ${impactLabels[change.impact]}`;
    }
    case "effort": {
      return change.effort === null
        ? "effort cleared"
        : `effort set to ${effortLabels[change.effort]}`;
    }
  }
}

/** What an edit did, as the sentence a toast shows after the identifier. */
export function changeSummary(
  change: IssueChange,
  catalog: Catalog,
  issue?: CachedIssue,
) {
  const split = splitIssueChange(change);
  if ("sizing" in split) return sizingSummary(split.sizing, issue);
  const { base } = split;
  switch (base.kind) {
    case "state": {
      return `status set to ${base.stateName}`;
    }
    case "assignee":
    case "project":
    case "move": {
      return referenceSummary(base, catalog);
    }
    case "label": {
      return `label ${base.name} ${base.add ? "added" : "removed"}`;
    }
    case "title": {
      return "title updated";
    }
    case "description": {
      return "description saved";
    }
    case "archive": {
      return base.archived ? "archived" : "unarchived";
    }
    case "vote": {
      return base.voted ? "vote added" : "vote removed";
    }
    case "parent": {
      return base.parentIdentifier === null
        ? "parent removed"
        : `moved under ${base.parentIdentifier}`;
    }
    case "due": {
      return base.dueDate === null
        ? "due date cleared"
        : `due ${dueLabel(base.dueDate, localToday()).toLowerCase()}`;
    }
  }
}

/** The cards a card sits between in a column, as `issues.move` wants them. */
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

function sizingUpdateInput(change: SizingChange) {
  switch (change.kind) {
    case "priority": {
      return change.priorityManual === undefined
        ? { priority: change.priority }
        : { priority: change.priority, priorityManual: change.priorityManual };
    }
    case "priorityAuto": {
      return { priorityManual: false };
    }
    case "urgency": {
      return { urgency: change.urgency };
    }
    case "impact": {
      return { impact: change.impact };
    }
    case "effort": {
      return { effort: change.effort };
    }
  }
}

/** The `issues.update` fields that make an edit. */
export function updateInput(change: IssueChange) {
  const split = splitIssueChange(change);
  if ("sizing" in split) return sizingUpdateInput(split.sizing);
  const { base } = split;
  switch (base.kind) {
    case "state": {
      return { stateName: base.stateName };
    }
    case "assignee": {
      return { assigneeKey: base.assigneeKey };
    }
    case "project": {
      return { projectSlug: base.projectSlug };
    }
    case "label": {
      return base.add
        ? { addLabels: [base.name] }
        : { removeLabels: [base.name] };
    }
    case "title": {
      return { title: base.title };
    }
    case "archive": {
      return { archived: base.archived };
    }
    case "description": {
      return {
        description: base.description,
        attachmentIds: base.attachmentIds,
      };
    }
    case "parent": {
      return { parentIdentifier: base.parentIdentifier };
    }
    case "due": {
      return { dueDate: base.dueDate };
    }
    case "move":
    case "vote": {
      throw new Error(`A ${base.kind} is not an issue update`);
    }
  }
}
