import { useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Popover } from "@base-ui/react/popover";
import { localToday } from "#client/due/dates.ts";
import { duePresetNames, duePresets } from "#client/due/due-filter.ts";
import { duePanel } from "#client/due/due-picker.tsx";
import { notifyError } from "#client/ui/toast.tsx";
import {
  Archive,
  CalendarClock,
  CircleDashed,
  Folder,
  ListFilter,
  PenLine,
  SignalHigh,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { actorNamespace, groupActors } from "#client/controls/actor-order.ts";
import {
  priorityOptions,
  stateOptions,
  teamStates,
} from "#client/controls/property-options.tsx";
import { Avatar, Swatch } from "#client/ui/ui.tsx";
import { CommandList, type CommandItem } from "./command-list.tsx";
import {
  filterChips,
  filterFields,
  filterValues,
  meValue,
  setFilter,
  toggleFilterValue,
  type FilterField,
} from "./filters.ts";
import { leavingPopup } from "#client/ui/leaving.tsx";

const fieldIcons: Record<FilterField, ReactNode> = {
  state: <CircleDashed size={15} />,
  priority: <SignalHigh size={15} />,
  assignee: <UserRound size={15} />,
  creator: <PenLine size={15} />,
  label: <Tag size={15} />,
  project: <Folder size={15} />,
  due: <CalendarClock size={15} />,
  archived: <Archive size={15} />,
};

/** The due filter's own row that asks for a day instead of a preset. */
const dueBefore = "before";

type Options = { value: string; label: string; icon?: ReactNode }[];

function actorOptions(bootstrap: BootstrapData, withMe: boolean): Options {
  const me = currentActor();
  const actors = groupActors(bootstrap.actors, {
    query: "",
    expanded: new Set(bootstrap.actors.map((actor) => actorNamespace(actor))),
  }).flatMap((group) => group.actors);
  return [
    ...(withMe
      ? [
          {
            value: meValue,
            label: "Me",
            icon: <Avatar actor={me} decorative />,
          },
        ]
      : []),
    ...actors.map((actor) => ({
      value: actor.key,
      label: actor.name,
      icon: <Avatar actor={actor} decorative />,
    })),
  ];
}

function fieldOptions(
  field: FilterField,
  bootstrap: BootstrapData,
  teamId: string,
): Options {
  switch (field) {
    case "state": {
      return stateOptions(teamStates(bootstrap, teamId));
    }
    case "priority": {
      return priorityOptions;
    }
    case "assignee": {
      return actorOptions(bootstrap, true);
    }
    case "creator": {
      return actorOptions(bootstrap, false);
    }
    case "label": {
      return bootstrap.labels
        .filter((label) => label.teamId === teamId)
        .map((label) => ({
          value: label.name,
          label: label.name,
          icon: <Swatch color={label.color} />,
        }));
    }
    case "project": {
      return bootstrap.projects
        .filter(({ archivedAt }) => archivedAt === null)
        .map((project) => ({
          value: project.slug,
          label: project.name,
          icon: <Swatch color={project.color} />,
        }));
    }
    case "due": {
      return [
        ...duePresets.map((preset) => ({
          value: preset,
          label: duePresetNames[preset],
        })),
        { value: dueBefore, label: "Due before…" },
      ];
    }
    case "archived": {
      return [{ value: "true", label: "Include archived issues" }];
    }
  }
}

/**
 * The one Filter control: pick a field, then its values, with search and
 * multi-select for status and labels. Active filters show as chips that
 * reopen their field or remove it. Every filter keeps its URL parameter.
 */
export function FilterBar({
  bootstrap,
  teamKey,
  projectRoute,
}: {
  bootstrap: BootstrapData;
  teamKey: string;
  /** On a project page the project is the page, not a filter. */
  projectRoute: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<FilterField>();
  const [pickingDay, setPickingDay] = useState(false);
  const DuePanel = duePanel.current?.DuePanel;
  const input = useRef<HTMLInputElement>(null);
  const team = bootstrap.teams.find(({ key }) => key === teamKey);
  const fields = filterFields.filter(
    (info) => !(projectRoute && info.field === "project"),
  );
  const chips = filterChips(params, bootstrap).filter(
    (chip) => !(projectRoute && chip.field === "project"),
  );
  const write = (next: URLSearchParams) => {
    setParams(next, { preventScrollReset: true });
  };
  const show = (next: FilterField | undefined) => {
    setField(next);
    setOpen(true);
  };
  const info = fields.find((item) => item.field === field);
  const values = field === undefined ? [] : filterValues(params, field);
  const items: CommandItem[] =
    field === undefined
      ? fields.map((item) => ({
          id: item.field,
          label: item.name,
          icon: fieldIcons[item.field],
          ...(filterValues(params, item.field).length > 0
            ? { hint: String(filterValues(params, item.field).length) }
            : {}),
        }))
      : fieldOptions(field, bootstrap, team?.id ?? "").map((option) => ({
          id: option.value,
          label: option.label,
          icon: option.icon,
          checked: values.includes(option.value),
        }));
  return (
    <div className="filter-bar">
      <Popover.Root
        open={open}
        onOpenChange={(next, details) => {
          // Escape on a field's values steps back to the list of fields.
          if (field !== undefined && !next && details.reason === "escape-key") {
            details.cancel();
            if (pickingDay) {
              setPickingDay(false);
            } else {
              setField(undefined);
            }
            return;
          }
          setOpen(next);
          if (!next) {
            setField(undefined);
            setPickingDay(false);
          }
        }}
      >
        <Popover.Trigger
          id="filter-button"
          className="toolbar-button"
          aria-keyshortcuts="f"
        >
          <ListFilter size={14} aria-hidden="true" />
          <span>Filter</span>
          <kbd aria-hidden="true">F</kbd>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className="picker-positioner"
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={8}
          >
            <Popover.Popup
              className="picker-popup filter-popover"
              render={leavingPopup}
              initialFocus={input}
              aria-label="Filter issues"
            >
              {pickingDay && DuePanel !== undefined ? (
                <DuePanel
                  autoFocus
                  value={null}
                  today={localToday()}
                  clearable={false}
                  label="Due on or before"
                  inputRef={input}
                  onPick={(day) => {
                    if (day !== null) {
                      write(setFilter(params, "due", [day]));
                    }
                    setOpen(false);
                    setField(undefined);
                    setPickingDay(false);
                  }}
                />
              ) : (
                <CommandList
                  key={field ?? "fields"}
                  inputRef={input}
                  label={
                    info === undefined ? "Filter by" : `Filter by ${info.name}`
                  }
                  placeholder={
                    info === undefined ? "Filter by…" : `${info.name} is…`
                  }
                  items={items}
                  {...(field === undefined
                    ? {}
                    : {
                        back: () => {
                          setField(undefined);
                        },
                      })}
                  choose={(item) => {
                    if (field === undefined) {
                      const next = filterFields.find(
                        (each) => each.field === item.id,
                      )?.field;
                      if (next === "due") {
                        duePanel.prefetch();
                      }
                      setField(next);
                      return;
                    }
                    if (field === "due" && item.id === dueBefore) {
                      void (async () => {
                        try {
                          await duePanel.load();
                        } catch {
                          notifyError("The date picker could not load.");
                          return;
                        }
                        setPickingDay(true);
                      })();
                      return;
                    }
                    write(toggleFilterValue(params, field, item.id));
                    if (info?.multiple !== true) {
                      setOpen(false);
                      setField(undefined);
                    }
                  }}
                />
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {chips.length > 0 && (
        <ul className="filter-chips" aria-label="Active filters">
          {chips.map((chip) => (
            <li className="filter-chip" key={chip.field}>
              <button
                type="button"
                className="filter-chip-body"
                onClick={() => {
                  show(chip.field);
                }}
              >
                <span className="option-icon">{fieldIcons[chip.field]}</span>
                <span className="chip-subject">{chip.subject}</span>{" "}
                {chip.verb !== "" && (
                  <>
                    <span className="chip-verb">{chip.verb}</span>{" "}
                  </>
                )}
                <span className="chip-values">{chip.values}</span>
              </button>
              <button
                type="button"
                className="filter-chip-remove"
                aria-label={`Remove filter: ${chip.text}`}
                onClick={() => {
                  write(setFilter(params, chip.field, []));
                }}
              >
                <X size={12} />
              </button>
            </li>
          ))}
          {chips.length > 1 && (
            <li>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  let next = new URLSearchParams(params);
                  for (const chip of chips) {
                    next = setFilter(next, chip.field, []);
                  }
                  write(next);
                }}
              >
                Clear filters
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
