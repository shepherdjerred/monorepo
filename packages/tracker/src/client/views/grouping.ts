import type { BootstrapData, Issue } from "#client/data/api.ts";
import { priorities } from "#client/data/issue-changes.ts";
import type { GroupBy } from "./display-options.ts";
import type { CalendarDay } from "#client/due/dates.ts";
import {
  dueBucket,
  dueBucketLabels,
  dueBucketOrder,
  type DueBucket,
} from "#client/due/due-display.ts";

type State = BootstrapData["states"][number];

/** What a group header shows beside its name. */
export type GroupMark =
  | { type: "state"; state: State }
  | { type: "priority"; priority: number }
  | { type: "project"; color: string | undefined }
  | { type: "assignee"; actor: Issue["assignee"] }
  | { type: "due"; bucket: DueBucket };

export type GroupHeader = {
  kind: "group";
  key: string;
  label: string;
  mark: GroupMark;
  count: number;
  collapsed: boolean;
  /** A status with no issues still shows, as a compact header. */
  empty: boolean;
};
export type IssueRow = {
  kind: "issue";
  issue: Issue;
  /** 1-based place among the issue rows a reader can reach. */
  position: number;
  group: string | undefined;
};
export type ListRow = GroupHeader | IssueRow;

type Bucket = { key: string; label: string; mark: GroupMark; sort: string };

// Urgent first and "No priority" last, as on a triage board.
const priorityRank = (priority: number) => (priority === 0 ? 5 : priority);

function dueBucketOf(issue: Issue, today: CalendarDay): Bucket {
  const bucket = dueBucket(issue.dueDate, today, issue.state.type);
  return {
    key: bucket,
    label: dueBucketLabels[bucket],
    mark: { type: "due", bucket },
    sort: String(dueBucketOrder.indexOf(bucket)),
  };
}

function bucketOf(
  issue: Issue,
  groupBy: Exclude<GroupBy, "none">,
  today: CalendarDay,
): Bucket {
  switch (groupBy) {
    case "due": {
      return dueBucketOf(issue, today);
    }
    case "status": {
      return {
        key: issue.state.name,
        label: issue.state.name,
        mark: { type: "state", state: issue.state },
        sort: String(issue.state.position).padStart(6, "0"),
      };
    }
    case "priority": {
      return {
        key: String(issue.priority),
        label: priorities[issue.priority] ?? "No priority",
        mark: { type: "priority", priority: issue.priority },
        sort: String(priorityRank(issue.priority)),
      };
    }
    case "project": {
      return issue.project === null
        ? {
            key: "none",
            label: "No project",
            mark: { type: "project", color: undefined },
            sort: "￿",
          }
        : {
            key: issue.project.slug,
            label: issue.project.name,
            mark: { type: "project", color: issue.project.color },
            sort: issue.project.name.toLowerCase(),
          };
    }
    case "assignee": {
      return issue.assignee === null
        ? {
            key: "none",
            label: "Unassigned",
            mark: { type: "assignee", actor: null },
            sort: "￿",
          }
        : {
            key: issue.assignee.key,
            label: issue.assignee.name,
            mark: { type: "assignee", actor: issue.assignee },
            sort: issue.assignee.name.toLowerCase(),
          };
    }
  }
}

function stateBuckets(states: readonly State[]): Bucket[] {
  return [...states]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((state) => ({
      key: state.name,
      label: state.name,
      mark: { type: "state", state },
      sort: String(state.position).padStart(6, "0"),
    }));
}

/**
 * The rows of a list: group headers, each followed by its issues unless it
 * is collapsed. Issues keep the order they arrived in within their group.
 * Grouping by status shows every status of the team in workflow order, an
 * empty one as a compact header; other groupings show only groups in use.
 */
export function buildRows(
  items: readonly Issue[],
  options: {
    groupBy: GroupBy;
    collapsed: ReadonlySet<string>;
    states: readonly State[];
    /** The browser's calendar day, for grouping by due date. */
    today: CalendarDay;
  },
): { rows: ListRow[]; issues: Issue[] } {
  const { groupBy } = options;
  if (groupBy === "none") {
    return {
      rows: items.map((issue, index) => ({
        kind: "issue",
        issue,
        position: index + 1,
        group: undefined,
      })),
      issues: [...items],
    };
  }
  const buckets = new Map<string, { bucket: Bucket; issues: Issue[] }>();
  if (groupBy === "status") {
    for (const bucket of stateBuckets(options.states)) {
      buckets.set(bucket.key, { bucket, issues: [] });
    }
  }
  for (const issue of items) {
    const bucket = bucketOf(issue, groupBy, options.today);
    const known = buckets.get(bucket.key) ?? { bucket, issues: [] };
    known.issues.push(issue);
    buckets.set(bucket.key, known);
  }
  const ordered = [...buckets.values()].sort((a, b) =>
    a.bucket.sort.localeCompare(b.bucket.sort),
  );
  const rows: ListRow[] = [];
  const issues: Issue[] = [];
  for (const { bucket, issues: members } of ordered) {
    const collapsed = options.collapsed.has(bucket.key);
    rows.push({
      kind: "group",
      key: bucket.key,
      label: bucket.label,
      mark: bucket.mark,
      count: members.length,
      collapsed,
      empty: members.length === 0,
    });
    if (collapsed) {
      continue;
    }
    for (const issue of members) {
      issues.push(issue);
      rows.push({
        kind: "issue",
        issue,
        position: issues.length,
        group: bucket.key,
      });
    }
  }
  return { rows, issues };
}
