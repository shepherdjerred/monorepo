import {
  Priority,
  type Label,
  type Project,
  type Section,
  type Task,
} from "@shepherdjerred/facet-protocol";
import {
  addDays,
  compareCivilDays,
  dayHeading,
  dayNumber,
  effectiveCivilDay,
  formatWeekdayShort,
  type CivilDay,
} from "./civil-day.ts";
import type { WorkspaceData } from "./sync.ts";

export type Destination =
  | { kind: "section"; section: "inbox" | "today" | "upcoming" | "completed" }
  | { kind: "project"; id: string }
  | { kind: "label"; id: string };

export type TaskGroup = {
  id: string;
  title: string;
  overdue: boolean;
  civilDate?: CivilDay;
  tasks: Task[];
};

export type WeekDay = {
  offset: number;
  civilDate: CivilDay;
  weekdayShort: string;
  dayNumber: string;
  taskCount: number;
};

export type WorkspaceView = {
  title: string;
  groups: TaskGroup[];
  week: WeekDay[];
};

const PRIORITY_RANK: Record<Priority, number> = {
  [Priority.P1]: 1,
  [Priority.P2]: 2,
  [Priority.P3]: 3,
  [Priority.P4]: 4,
};

export function sortTasks(left: Task, right: Task): number {
  if (left.child_order !== right.child_order) {
    return left.child_order - right.child_order;
  }
  const priority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priority !== 0) return priority;
  if (left.created_at < right.created_at) return -1;
  return left.created_at > right.created_at ? 1 : 0;
}

function sortByDue(left: Task, right: Task, timeZone: string): number {
  const leftDue = effectiveCivilDay(left, timeZone) ?? "";
  const rightDue = effectiveCivilDay(right, timeZone) ?? "";
  if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
  return sortTasks(left, right);
}

function matchesSearch(task: Task, search: string): boolean {
  const query = search.trim().toLowerCase();
  return query === "" || task.title.toLowerCase().includes(query);
}

export function inactiveProjectIds(projects: readonly Project[]): Set<string> {
  const inactive = new Set(
    projects
      .filter((project) => project.is_archived || project.is_deleted)
      .map((project) => project.id),
  );
  const children = new Map<string, Project[]>();
  for (const project of projects) {
    if (project.parent_id === undefined || project.parent_id === "") continue;
    const list = children.get(project.parent_id) ?? [];
    list.push(project);
    children.set(project.parent_id, list);
  }
  const pending = [...inactive];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) break;
    for (const child of children.get(id) ?? []) {
      if (inactive.has(child.id)) continue;
      inactive.add(child.id);
      pending.push(child.id);
    }
  }
  return inactive;
}

export function activeProjects(projects: readonly Project[]): Project[] {
  const inactive = inactiveProjectIds(projects);
  return projects
    .filter((project) => !inactive.has(project.id))
    .sort((left, right) => {
      if (left.is_inbox !== right.is_inbox) return left.is_inbox ? -1 : 1;
      if (left.child_order !== right.child_order) {
        return left.child_order - right.child_order;
      }
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
      });
    });
}

export function activeLabels(labels: readonly Label[]): Label[] {
  return labels
    .filter((label) => !label.is_deleted)
    .sort((left, right) => left.item_order - right.item_order);
}

function topLevelOpen(data: WorkspaceData): Task[] {
  const inactive = inactiveProjectIds(data.projects);
  return data.tasks.filter(
    (task) =>
      !task.is_deleted &&
      !task.completed &&
      (task.parent_id === undefined || task.parent_id === "") &&
      !inactive.has(task.project_id),
  );
}

export function inboxTasks(data: WorkspaceData, search: string): Task[] {
  const inboxIds = new Set(
    activeProjects(data.projects)
      .filter((project) => project.is_inbox)
      .map((project) => project.id),
  );
  return topLevelOpen(data)
    .filter((task) =>
      inboxIds.size === 0
        ? task.project_id === ""
        : inboxIds.has(task.project_id) || task.project_id === "",
    )
    .filter((task) => matchesSearch(task, search))
    .sort(sortTasks);
}

export function todayGroups(
  data: WorkspaceData,
  search: string,
  current: CivilDay,
  timeZone: string,
): TaskGroup[] {
  const overdue: Task[] = [];
  const dueToday: Task[] = [];
  for (const task of topLevelOpen(data)) {
    if (!matchesSearch(task, search)) continue;
    const due = effectiveCivilDay(task, timeZone);
    if (due === undefined) continue;
    const order = compareCivilDays(due, current);
    if (order < 0) overdue.push(task);
    else if (order === 0) dueToday.push(task);
  }
  const groups: TaskGroup[] = [];
  if (overdue.length > 0) {
    groups.push({
      id: "overdue",
      title: "Overdue",
      overdue: true,
      tasks: overdue.sort((left, right) => sortByDue(left, right, timeZone)),
    });
  }
  groups.push({
    id: "today",
    title: "Due today",
    overdue: false,
    civilDate: current,
    tasks: dueToday.sort(sortTasks),
  });
  return groups;
}

export function upcomingWeek(
  data: WorkspaceData,
  current: CivilDay,
  timeZone: string,
  offset: number,
): WeekDay[] {
  const open = topLevelOpen(data);
  const days: WeekDay[] = [];
  for (let index = 0; index < 7; index += 1) {
    const dayOffset = offset + index;
    const civilDate = addDays(current, dayOffset);
    days.push({
      offset: dayOffset,
      civilDate,
      weekdayShort: formatWeekdayShort(civilDate),
      dayNumber: dayNumber(civilDate),
      taskCount: open.filter(
        (task) => effectiveCivilDay(task, timeZone) === civilDate,
      ).length,
    });
  }
  return days;
}

export function upcomingGroups(input: {
  data: WorkspaceData;
  search: string;
  current: CivilDay;
  timeZone: string;
  offset: number;
}): TaskGroup[] {
  const { data, search, current, timeZone, offset } = input;
  const start = addDays(current, offset);
  const end = addDays(current, offset + 28);
  const byDate = new Map<CivilDay, Task[]>();
  const overdue: Task[] = [];
  for (const task of topLevelOpen(data)) {
    if (!matchesSearch(task, search)) continue;
    const due = effectiveCivilDay(task, timeZone);
    if (due === undefined) continue;
    if (offset === 0 && compareCivilDays(due, current) < 0) {
      overdue.push(task);
      continue;
    }
    if (compareCivilDays(due, start) >= 0) {
      const list = byDate.get(due) ?? [];
      list.push(task);
      byDate.set(due, list);
    }
  }
  const groups: TaskGroup[] = [];
  if (overdue.length > 0) {
    groups.push({
      id: "overdue",
      title: "Overdue",
      overdue: true,
      tasks: overdue.sort((left, right) => sortByDue(left, right, timeZone)),
    });
  }
  const windowDays: CivilDay[] = [];
  for (let index = 0; index < 28; index += 1) {
    windowDays.push(addDays(current, offset + index));
  }
  const later = [...byDate.keys()].filter(
    (day) => compareCivilDays(day, end) >= 0,
  );
  const dates = [...new Set([...windowDays, ...later])].sort(compareCivilDays);
  for (const civilDate of dates) {
    groups.push({
      id: `upcoming.${civilDate}`,
      title: dayHeading(civilDate, current),
      overdue: false,
      civilDate,
      tasks: (byDate.get(civilDate) ?? []).sort(sortTasks),
    });
  }
  return groups;
}

export function completedTasks(data: WorkspaceData, search: string): Task[] {
  return data.tasks
    .filter(
      (task) =>
        !task.is_deleted &&
        task.completed &&
        (task.parent_id === undefined || task.parent_id === "") &&
        matchesSearch(task, search),
    )
    .sort((left, right) => {
      const leftKey = left.completed_at ?? left.updated_at;
      const rightKey = right.completed_at ?? right.updated_at;
      if (leftKey === rightKey) return 0;
      return leftKey < rightKey ? 1 : -1;
    });
}

function sectionsIn(data: WorkspaceData, projectId: string): Section[] {
  return data.sections
    .filter(
      (section) =>
        section.project_id === projectId &&
        !section.is_deleted &&
        !section.is_archived,
    )
    .sort((left, right) => left.section_order - right.section_order);
}

export function projectGroups(
  data: WorkspaceData,
  projectId: string,
  search: string,
): TaskGroup[] {
  const projectTasks = topLevelOpen(data)
    .filter(
      (task) => task.project_id === projectId && matchesSearch(task, search),
    )
    .sort(sortTasks);
  const sections = sectionsIn(data, projectId);
  const known = new Set(sections.map((section) => section.id));
  const unsectioned = projectTasks.filter((task) => {
    return (
      task.section_id === undefined ||
      task.section_id === "" ||
      !known.has(task.section_id)
    );
  });
  const groups: TaskGroup[] = [];
  if (unsectioned.length > 0 || sections.length === 0) {
    groups.push({
      id: `project.${projectId}.none`,
      title: "No section",
      overdue: false,
      tasks: unsectioned,
    });
  }
  for (const section of sections) {
    groups.push({
      id: `project.${projectId}.section.${section.id}`,
      title: section.name,
      overdue: false,
      tasks: projectTasks.filter((task) => task.section_id === section.id),
    });
  }
  return groups;
}

export function labelTasks(
  data: WorkspaceData,
  labelId: string,
  search: string,
): Task[] {
  return topLevelOpen(data)
    .filter(
      (task) => task.label_ids.includes(labelId) && matchesSearch(task, search),
    )
    .sort(sortTasks);
}

export function workspaceView(input: {
  data: WorkspaceData;
  destination: Destination;
  search: string;
  today: CivilDay;
  timeZone: string;
  upcomingOffset: number;
}): WorkspaceView {
  const { data, destination, search, today: current, timeZone } = input;
  switch (destination.kind) {
    case "section":
      switch (destination.section) {
        case "inbox":
          return {
            title: "Inbox",
            groups: [
              {
                id: "inbox",
                title: "Inbox",
                overdue: false,
                tasks: inboxTasks(data, search),
              },
            ],
            week: [],
          };
        case "today":
          return {
            title: "Today",
            groups: todayGroups(data, search, current, timeZone),
            week: [],
          };
        case "upcoming":
          return {
            title: "Upcoming",
            groups: upcomingGroups({
              data,
              search,
              current,
              timeZone,
              offset: input.upcomingOffset,
            }),
            week: upcomingWeek(data, current, timeZone, input.upcomingOffset),
          };
        case "completed":
          return {
            title: "Completed",
            groups: [
              {
                id: "completed",
                title: "Completed",
                overdue: false,
                tasks: completedTasks(data, search),
              },
            ],
            week: [],
          };
        default: {
          const unreachable: never = destination.section;
          throw new Error(`Unknown section: ${JSON.stringify(unreachable)}`);
        }
      }
    case "project": {
      const project = data.projects.find((item) => item.id === destination.id);
      return {
        title: project?.name ?? "Project",
        groups: projectGroups(data, destination.id, search),
        week: [],
      };
    }
    case "label": {
      const label = data.labels.find((item) => item.id === destination.id);
      return {
        title: label === undefined ? "Label" : `@${label.name}`,
        groups: [
          {
            id: `label.${destination.id}`,
            title: label?.name ?? "Label",
            overdue: false,
            tasks: labelTasks(data, destination.id, search),
          },
        ],
        week: [],
      };
    }
    default: {
      const unreachable: never = destination;
      throw new Error(`Unknown destination: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function subtaskCount(tasks: readonly Task[], parentId: string): number {
  return tasks.filter((task) => !task.is_deleted && task.parent_id === parentId)
    .length;
}

export function projectDepth(
  projects: readonly Project[],
  project: Project,
): number {
  let depth = 0;
  let parentId = project.parent_id;
  const seen = new Set<string>([project.id]);
  while (parentId !== undefined && parentId !== "" && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = projects.find((item) => item.id === parentId)?.parent_id;
    if (depth > 6) break;
  }
  return depth;
}

const NATIVE_SWATCHES: Record<string, string> = {
  charcoal: "#808085",
  berry_red: "#b8245e",
  red: "#db4036",
  orange: "#f28526",
  yellow: "#ebba14",
  green: "#29a654",
  teal: "#149ea3",
  blue: "#2973e0",
  grape: "#874dd9",
  magenta: "#e05299",
  salmon: "#f5827a",
  grey: "#9499a1",
};

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  silver: "#c0c0c0",
  gray: "#808080",
  white: "#ffffff",
  maroon: "#800000",
  red: "#ff0000",
  purple: "#800080",
  fuchsia: "#ff00ff",
  green: "#008000",
  lime: "#00ff00",
  olive: "#808000",
  yellow: "#ffff00",
  navy: "#000080",
  blue: "#0000ff",
  teal: "#008080",
  aqua: "#00ffff",
};

export function swatchColor(raw: string): string | undefined {
  const value = raw.trim().toLowerCase();
  const swatch = NATIVE_SWATCHES[value];
  if (swatch !== undefined) return swatch;
  return /^#[0-9a-f]{3,8}$/.test(value) ? value : NAMED_COLORS[value];
}
