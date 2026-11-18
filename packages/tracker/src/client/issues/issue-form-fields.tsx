import {
  CalendarClock,
  Folder,
  GitFork,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import type { Effort, Impact, Urgency } from "#shared/schema.ts";
import { localToday } from "#client/due/dates.ts";
import { dueLabel } from "#client/due/due-display.ts";
import { duePanel, openDuePicker } from "#client/due/due-picker.tsx";
import type { BootstrapData } from "#client/data/api.ts";
import { EnumPicker, type EnumOption } from "#client/controls/enum-picker.tsx";
import {
  effortOptions,
  impactOptions,
  parseEffort,
  parseImpact,
  parseUrgency,
  priorityOptions,
  stateOptions,
  type teamStates,
  urgencyOptions,
} from "#client/controls/property-options.tsx";
import type { SearchPickerKind } from "#client/controls/picker-items.tsx";
import { Swatch } from "#client/ui/ui.tsx";

export type Choices = {
  stateName: string | undefined;
  priority: number;
  priorityManual: boolean;
  urgency: Urgency | null;
  impact: Impact | null;
  effort: Effort | null;
  projectSlug: string | null;
  labels: readonly string[];
  assigneeKey: string | null;
  parentIdentifier: string | null;
  dueDate: string | null;
};

export type SizingPatch = Partial<
  Pick<Choices, "priority" | "priorityManual" | "urgency" | "impact">
>;

export function chosenValues(kind: SearchPickerKind, choices: Choices) {
  if (kind === "labels") return choices.labels;
  const value = kind === "assignee" ? choices.assigneeKey : choices.projectSlug;
  return value === null ? [] : [value];
}

export function withChoice(
  known: Choices,
  kind: SearchPickerKind,
  value: string | null,
  add: boolean,
): Choices {
  if (kind === "assignee") return { ...known, assigneeKey: value };
  if (kind === "project") return { ...known, projectSlug: value };
  const others = known.labels.filter((name) => name !== value);
  return {
    ...known,
    labels: add && value !== null ? [...others, value] : others,
  };
}

export function FormChips(props: {
  choices: Choices;
  assigneeName?: string | undefined;
  project: BootstrapData["projects"][number] | undefined;
  pick: (kind: SearchPickerKind, anchor: HTMLElement) => void;
  choose: (change: Partial<Choices>) => void;
}) {
  const { choices, assigneeName = "Assignee", project, pick, choose } = props;
  const { dueDate, parentIdentifier, labels } = choices;
  const projectIcon =
    project === undefined ? (
      <Folder size={14} aria-hidden="true" />
    ) : (
      <Swatch color={project.color} />
    );
  const searchChips = [
    [
      "assignee",
      assigneeName,
      <UserRound key="a" size={14} aria-hidden="true" />,
    ],
    ["project", project?.name ?? "Project", projectIcon],
    [
      "labels",
      labels.length === 0 ? "Labels" : labels.join(", "),
      <Tag key="l" size={14} aria-hidden="true" />,
    ],
  ] as const;
  return (
    <div className="property-chips">
      {searchChips.map(([kind, label, icon]) => (
        <button
          key={kind}
          type="button"
          className="property-chip"
          aria-haspopup="dialog"
          onClick={(event) => {
            pick(kind, event.currentTarget);
          }}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
      <button
        type="button"
        className="property-chip"
        aria-haspopup="dialog"
        onPointerEnter={duePanel.prefetch}
        onFocus={duePanel.prefetch}
        onClick={(event) => {
          openDuePicker({
            anchor: event.currentTarget,
            title: "Due date of the new issue",
            value: dueDate,
            pick: (day) => {
              choose({ dueDate: day });
            },
          });
        }}
      >
        <CalendarClock size={14} aria-hidden="true" />
        <span>
          {dueDate === null
            ? "Due date"
            : `Due ${dueLabel(dueDate, localToday())}`}
        </span>
      </button>
      {parentIdentifier !== null && (
        <span className="property-chip parent-chip">
          <GitFork size={14} aria-hidden="true" />
          <span>Sub-issue of {parentIdentifier}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Do not make it a sub-issue of ${parentIdentifier}`}
            onClick={() => {
              choose({ parentIdentifier: null });
            }}
          >
            <X size={12} />
          </button>
        </span>
      )}
    </div>
  );
}

type SelectField =
  "Team" | "Status" | "Priority" | "Urgency" | "Impact" | "Effort";

export function FormSelects(props: {
  teams: BootstrapData["teams"];
  teamKey: string;
  states: ReturnType<typeof teamStates>;
  stateName?: string | undefined;
  choices: Choices;
  onTeam: (value: string) => void;
  onSizing: (patch: SizingPatch) => void;
  choose: (change: Partial<Choices>) => void;
}) {
  const { choices, onSizing, choose, stateName = "" } = props;
  const handlers: Record<SelectField, (value: string) => void> = {
    Team: props.onTeam,
    Status: (value) => {
      choose({ stateName: value });
    },
    Priority: (value) => {
      onSizing({ priority: Number(value) });
    },
    Urgency: (value) => {
      onSizing({ urgency: parseUrgency(value) });
    },
    Impact: (value) => {
      onSizing({ impact: parseImpact(value) });
    },
    Effort: (value) => {
      choose({ effort: parseEffort(value) });
    },
  };
  const items: [SelectField, string, readonly EnumOption[]][] = [
    [
      "Team",
      props.teamKey,
      props.teams.map((team) => ({ value: team.key, label: team.key })),
    ],
    ["Status", stateName, stateOptions(props.states)],
    ["Priority", String(choices.priority), priorityOptions],
    ["Urgency", choices.urgency ?? "", urgencyOptions],
    ["Impact", choices.impact ?? "", impactOptions],
    ["Effort", choices.effort ?? "", effortOptions],
  ];
  return (
    <div className="form-selects">
      {items.map(([label, value, options]) => (
        <label key={label}>
          {label}
          <EnumPicker
            label={label}
            value={value}
            options={options}
            onChange={handlers[label]}
          />
        </label>
      ))}
    </div>
  );
}
