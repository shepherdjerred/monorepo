import {
  ArrowDownWideNarrow,
  CalendarClock,
  CalendarPlus,
  CaseSensitive,
  CircleDashed,
  Clock,
  Crosshair,
  Folder,
  Gauge,
  GripVertical,
  Hash,
  Rows3,
  SignalHigh,
  ThumbsUp,
  UserRound,
  Zap,
} from "lucide-react";
import {
  EffortSchema,
  ImpactSchema,
  UrgencySchema,
  type Effort,
  type Impact,
  type Urgency,
} from "#shared/schema.ts";
import type { BootstrapData } from "#client/data/api.ts";
import {
  effortLabels,
  impactLabels,
  priorities,
  urgencyLabels,
} from "#client/data/issue-changes.ts";
import {
  EffortGlyph,
  ImpactGlyph,
  PriorityGlyph,
  StateIcon,
  UrgencyGlyph,
} from "#client/ui/icons.tsx";
import type {
  BoardSort,
  GroupBy,
  Sort,
  SortDir,
} from "#client/views/display-options.ts";
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

export const urgencyOrder: readonly Urgency[] = ["high", "medium", "low"];
export const impactOrder: readonly Impact[] = ["high", "medium", "low"];
export const effortOrder: readonly Effort[] = ["xs", "s", "m", "l", "xl"];

export const urgencyOptions: EnumOption[] = [
  {
    value: "",
    label: "No urgency",
    icon: (
      <span className="sizing-glyph urgency-none">
        <UrgencyGlyph value={null} />
      </span>
    ),
  },
  ...urgencyOrder.map((value) => ({
    value,
    label: urgencyLabels[value],
    icon: (
      <span className={`sizing-glyph urgency-${value}`}>
        <UrgencyGlyph value={value} />
      </span>
    ),
  })),
];

export const impactOptions: EnumOption[] = [
  {
    value: "",
    label: "No impact",
    icon: (
      <span className="sizing-glyph impact-none">
        <ImpactGlyph value={null} />
      </span>
    ),
  },
  ...impactOrder.map((value) => ({
    value,
    label: impactLabels[value],
    icon: (
      <span className={`sizing-glyph impact-${value}`}>
        <ImpactGlyph value={value} />
      </span>
    ),
  })),
];

export const effortOptions: EnumOption[] = [
  {
    value: "",
    label: "No effort",
    icon: (
      <span className="sizing-glyph effort-none">
        <EffortGlyph value={null} />
      </span>
    ),
  },
  ...effortOrder.map((value) => ({
    value,
    label: effortLabels[value],
    icon: (
      <span className={`sizing-glyph effort-${value}`}>
        <EffortGlyph value={value} />
      </span>
    ),
  })),
];

export const parseUrgency = (value: string): Urgency | null =>
  value === "" ? null : UrgencySchema.parse(value);
export const parseImpact = (value: string): Impact | null =>
  value === "" ? null : ImpactSchema.parse(value);
export const parseEffort = (value: string): Effort | null =>
  value === "" ? null : EffortSchema.parse(value);

export const sortOptions: (EnumOption & { value: Sort })[] = [
  { value: "updated", label: "Last updated", icon: <Clock size={14} /> },
  { value: "created", label: "Last created", icon: <CalendarPlus size={14} /> },
  { value: "priority", label: "Priority", icon: <SignalHigh size={14} /> },
  { value: "urgency", label: "Urgency", icon: <Zap size={14} /> },
  { value: "impact", label: "Impact", icon: <Crosshair size={14} /> },
  { value: "effort", label: "Effort", icon: <Gauge size={14} /> },
  { value: "votes", label: "Most votes", icon: <ThumbsUp size={14} /> },
  { value: "due", label: "Due date", icon: <CalendarClock size={14} /> },
  { value: "number", label: "Identifier", icon: <Hash size={14} /> },
  { value: "title", label: "Title", icon: <CaseSensitive size={14} /> },
];

export const boardSortOptions: (EnumOption & { value: BoardSort })[] = [
  { value: "board", label: "Manual", icon: <GripVertical size={14} /> },
  ...sortOptions,
];

const sortDirectionLabels: Record<
  BoardSort,
  readonly [asc: string, desc: string]
> = {
  board: ["manual order", "manual order"],
  updated: ["oldest to newest", "newest to oldest"],
  created: ["oldest to newest", "newest to oldest"],
  priority: ["urgent to low", "low to urgent"],
  urgency: ["high to low", "low to high"],
  impact: ["high to low", "low to high"],
  effort: ["XS to XL", "XL to XS"],
  votes: ["fewest to most", "most to fewest"],
  due: ["soonest to latest", "latest to soonest"],
  number: ["oldest to newest", "newest to oldest"],
  title: ["A to Z", "Z to A"],
};

export function sortDirectionSummary(sort: BoardSort, dir: SortDir): string {
  const [asc, desc] = sortDirectionLabels[sort];
  return dir === "asc" ? asc : desc;
}

export const groupOptions: (EnumOption & { value: GroupBy })[] = [
  { value: "status", label: "Status", icon: <CircleDashed size={14} /> },
  {
    value: "priority",
    label: "Priority",
    icon: <ArrowDownWideNarrow size={14} />,
  },
  { value: "urgency", label: "Urgency", icon: <Zap size={14} /> },
  { value: "impact", label: "Impact", icon: <Crosshair size={14} /> },
  { value: "effort", label: "Effort", icon: <Gauge size={14} /> },
  { value: "project", label: "Project", icon: <Folder size={14} /> },
  { value: "assignee", label: "Assignee", icon: <UserRound size={14} /> },
  { value: "due", label: "Due date", icon: <CalendarClock size={14} /> },
  { value: "none", label: "No grouping", icon: <Rows3 size={14} /> },
];
