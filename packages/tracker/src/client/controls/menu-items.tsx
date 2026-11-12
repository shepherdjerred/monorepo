import { createContext, use, type ReactNode } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  CalendarClock,
  CalendarDays,
  CalendarX2,
  Check,
  ChevronRight,
  CircleDashed,
  Folder,
  SignalHigh,
  Tag,
  UserRound,
  UserRoundCheck,
} from "lucide-react";
import type { BootstrapData, Issue } from "#client/data/api.ts";
import { bulkLabelChange } from "#client/data/bulk-changes.ts";
import { currentActor } from "#client/data/identity.ts";
import { ariaShortcut, shortcutKeys } from "#client/shell/shortcuts.ts";
import { Avatar, Swatch } from "#client/ui/ui.tsx";
import { groupActors } from "./actor-order.ts";
import {
  applyChange,
  assignToMe,
  pickDue,
  pickProperty,
} from "./issue-actions.ts";
import { localToday, quickChoices } from "#client/due/dates.ts";
import { dueLabel } from "#client/due/due-display.ts";
import {
  priorityOptions,
  stateOptions,
  teamStates,
} from "./property-options.tsx";

/** The parts of the issue context menu: items and property submenus. */
/** Whether a click is the finger lifting from the long press that opened the menu. */
export const ReleaseContext = createContext<(event: Event) => boolean>(
  () => false,
);

export function Item({
  icon,
  label,
  shortcut,
  onClick,
  danger = false,
  checked,
}: {
  icon: ReactNode;
  label: string;
  /** The shell action whose keys the item shows. */
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  checked?: boolean;
}) {
  const hint = shortcut === undefined ? undefined : shortcutKeys(shortcut);
  const released = use(ReleaseContext);
  return (
    <ContextMenu.Item
      className={`menu-item ${danger ? "danger" : ""}`}
      aria-keyshortcuts={
        shortcut === undefined ? undefined : ariaShortcut(shortcut)
      }
      onClick={(event) => {
        if (released(event.nativeEvent)) {
          event.preventBaseUIHandler();
          return;
        }
        onClick();
      }}
    >
      <span className="option-icon">{icon}</span>
      <span className="option-label">{label}</span>
      {checked === true && (
        <Check size={14} className="menu-check" aria-hidden="true" />
      )}
      {hint !== undefined && <kbd aria-hidden="true">{hint}</kbd>}
    </ContextMenu.Item>
  );
}

function Submenu({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <ContextMenu.SubmenuRoot>
      <ContextMenu.SubmenuTrigger className="menu-item">
        <span className="option-icon">{icon}</span>
        <span className="option-label">{label}</span>
        <ChevronRight size={14} className="menu-chevron" />
      </ContextMenu.SubmenuTrigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner
          className="picker-positioner"
          sideOffset={2}
          alignOffset={-4}
        >
          <ContextMenu.Popup className="menu-popup">
            {children}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.SubmenuRoot>
  );
}

const shared = <T,>(values: readonly T[]) =>
  values.every((value) => value === values[0]) ? values[0] : undefined;

export function PropertyMenus({
  issues,
  bootstrap,
  anchor,
}: {
  issues: readonly Issue[];
  bootstrap: BootstrapData;
  anchor: () => HTMLElement | null;
}) {
  const identifiers = issues.map(({ identifier }) => identifier);
  const [first] = issues;
  if (first === undefined) {
    return null;
  }
  const state = shared(issues.map((issue) => issue.state.name));
  const priority = shared(issues.map((issue) => issue.priority));
  const assignee = shared(issues.map((issue) => issue.assignee?.key ?? ""));
  const project = shared(issues.map((issue) => issue.project?.slug ?? ""));
  const due = shared(issues.map((issue) => issue.dueDate)) ?? null;
  const today = localToday();
  const me = currentActor().key;
  const released = use(ReleaseContext);
  const people = groupActors(
    bootstrap.actors.filter(({ key }) => key !== me),
    { query: "", expanded: new Set() },
  ).flatMap((group) => group.actors);
  return (
    <>
      <Submenu icon={<CircleDashed size={15} />} label="Status">
        {stateOptions(teamStates(bootstrap, first.teamId)).map((option) => (
          <Item
            key={option.value}
            icon={option.icon}
            label={option.label}
            checked={state === option.value}
            onClick={() => {
              applyChange(identifiers, {
                kind: "state",
                stateName: option.value,
              });
            }}
          />
        ))}
      </Submenu>
      <Submenu icon={<SignalHigh size={15} />} label="Priority">
        {priorityOptions.map((option) => (
          <Item
            key={option.value}
            icon={option.icon}
            label={option.label}
            checked={String(priority) === option.value}
            onClick={() => {
              applyChange(identifiers, {
                kind: "priority",
                priority: Number(option.value),
              });
            }}
          />
        ))}
      </Submenu>
      <Submenu icon={<UserRound size={15} />} label="Assignee">
        <Item
          icon={<UserRoundCheck size={15} />}
          label="Assign to me"
          shortcut="i"
          checked={assignee === me}
          onClick={() => {
            assignToMe(identifiers);
          }}
        />
        <Item
          icon={<span className="unassigned" aria-hidden="true" />}
          label="Unassigned"
          checked={assignee === ""}
          onClick={() => {
            applyChange(identifiers, { kind: "assignee", assigneeKey: null });
          }}
        />
        {people.slice(0, 8).map((actor) => (
          <Item
            key={actor.key}
            icon={<Avatar actor={actor} decorative />}
            label={actor.name}
            checked={assignee === actor.key}
            onClick={() => {
              applyChange(identifiers, {
                kind: "assignee",
                assigneeKey: actor.key,
              });
            }}
          />
        ))}
        <ContextMenu.Separator className="menu-separator" />
        <Item
          icon={<UserRound size={15} />}
          label="Search people and agents…"
          onClick={() => {
            const target = anchor();
            if (target !== null) {
              requestAnimationFrame(() => {
                pickProperty("assignee", identifiers, target);
              });
            }
          }}
        />
      </Submenu>
      <Submenu icon={<Tag size={15} />} label="Labels">
        {bootstrap.labels
          .filter(({ teamId }) => teamId === first.teamId)
          .map((label) => (
            <ContextMenu.CheckboxItem
              key={label.id}
              className="menu-item"
              onClick={(event) => {
                if (released(event.nativeEvent)) {
                  event.preventBaseUIHandler();
                }
              }}
              checked={issues.every((issue) =>
                issue.labels.some(({ name }) => name === label.name),
              )}
              onCheckedChange={() => {
                applyChange(identifiers, bulkLabelChange(issues, label.name));
              }}
            >
              <span className="option-icon">
                <Swatch color={label.color} />
              </span>
              <span className="option-label">{label.name}</span>
              <ContextMenu.CheckboxItemIndicator className="menu-check">
                <Check size={14} />
              </ContextMenu.CheckboxItemIndicator>
            </ContextMenu.CheckboxItem>
          ))}
      </Submenu>
      <Submenu icon={<CalendarClock size={15} />} label="Due date">
        {quickChoices(today).map((choice) => (
          <Item
            key={choice.id}
            icon={<CalendarClock size={15} />}
            label={`${choice.label} · ${dueLabel(choice.day, today)}`}
            checked={due === choice.day}
            onClick={() => {
              applyChange(identifiers, { kind: "due", dueDate: choice.day });
            }}
          />
        ))}
        <ContextMenu.Separator className="menu-separator" />
        <Item
          icon={<CalendarDays size={15} />}
          label="Pick a date…"
          shortcut="D"
          onClick={() => {
            const target = anchor();
            if (target !== null) {
              requestAnimationFrame(() => {
                pickDue(identifiers, target);
              });
            }
          }}
        />
        {due !== null && (
          <Item
            icon={<CalendarX2 size={15} />}
            label="Clear due date"
            onClick={() => {
              applyChange(identifiers, { kind: "due", dueDate: null });
            }}
          />
        )}
      </Submenu>
      <Submenu icon={<Folder size={15} />} label="Project">
        <Item
          icon={<Folder size={15} />}
          label="No project"
          checked={project === ""}
          onClick={() => {
            applyChange(identifiers, { kind: "project", projectSlug: null });
          }}
        />
        {bootstrap.projects
          .filter(({ archivedAt }) => archivedAt === null)
          .map((item) => (
            <Item
              key={item.id}
              icon={<Swatch color={item.color} />}
              label={item.name}
              checked={project === item.slug}
              onClick={() => {
                applyChange(identifiers, {
                  kind: "project",
                  projectSlug: item.slug,
                });
              }}
            />
          ))}
      </Submenu>
    </>
  );
}
