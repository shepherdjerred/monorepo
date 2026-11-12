import {
  ArrowDownWideNarrow,
  CalendarPlus,
  CircleDashed,
  Clock,
  Folder,
  Rows3,
  SignalHigh,
  ThumbsUp,
  UserRound,
} from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { priorities } from "#client/data/issue-changes.ts";
import { PriorityGlyph, StateIcon } from "#client/ui/icons.tsx";
import type { GroupBy, Sort } from "#client/views/display-options.ts";
import type { EnumOption } from "./enum-picker.tsx";

type State = BootstrapData["states"][number];

/** A team's statuses in workflow order. */
export function teamStates(bootstrap: BootstrapData, teamId: string) {
  return bootstrap.states
    .filter((state) => state.teamId === teamId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function stateOptions(states: readonly State[]): EnumOption[] {
  return states.map((state) => ({
    value: state.name,
    label: state.name,
    icon: <StateIcon type={state.type} color={state.color} />,
  }));
}

// Listed as Linear does: no priority, then urgent down to low.
export const priorityOrder = [0, 1, 2, 3, 4];

export const priorityOptions: EnumOption[] = priorityOrder.map((value) => ({
  value: String(value),
  label: priorities[value] ?? "No priority",
  icon: (
    <span className={`priority priority-${String(value)}`}>
      <PriorityGlyph value={value} />
    </span>
  ),
}));

export const sortOptions: (EnumOption & { value: Sort })[] = [
  { value: "updated", label: "Last updated", icon: <Clock size={14} /> },
  { value: "created", label: "Last created", icon: <CalendarPlus size={14} /> },
  { value: "priority", label: "Priority", icon: <SignalHigh size={14} /> },
  { value: "votes", label: "Most votes", icon: <ThumbsUp size={14} /> },
];

export const groupOptions: (EnumOption & { value: GroupBy })[] = [
  { value: "status", label: "Status", icon: <CircleDashed size={14} /> },
  {
    value: "priority",
    label: "Priority",
    icon: <ArrowDownWideNarrow size={14} />,
  },
  { value: "project", label: "Project", icon: <Folder size={14} /> },
  { value: "assignee", label: "Assignee", icon: <UserRound size={14} /> },
  { value: "none", label: "No grouping", icon: <Rows3 size={14} /> },
];
