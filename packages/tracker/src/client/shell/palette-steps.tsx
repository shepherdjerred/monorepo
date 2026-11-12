import type { ReactNode } from "react";
import { Folder } from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { bulkLabelChange } from "#client/data/bulk-changes.ts";
import { loadedIssue } from "#client/data/mutations.ts";
import { actorNamespace, groupActors } from "#client/controls/actor-order.ts";
import { applyChange } from "#client/controls/issue-actions.ts";
import {
  priorityOptions,
  stateOptions,
  teamStates,
} from "#client/controls/property-options.tsx";
import { Avatar, Swatch } from "#client/ui/ui.tsx";

/** One row of the palette: a command, or a step into a nested list. */
export type PaletteEntry = {
  id: string;
  label: string;
  icon: ReactNode;
  section: string;
  hint?: string | undefined;
  checked?: boolean;
  /** Run the command and keep the palette open, as a label toggle does. */
  stay?: boolean;
  /** Shown whatever is typed: it was made from what is typed. */
  always?: boolean;
  run?: () => void;
  step?: PaletteStep;
};

export type PaletteStep = {
  id: string;
  title: string;
  placeholder: string;
  /** The step's rows; some read what is typed, as a due date does. */
  entries: (query: string) => PaletteEntry[];
  /** The step picks an issue from search results, as "Set parent" does. */
  issues?: { exclude: readonly string[]; pick: (identifier: string) => void };
};

/** The nested lists the palette steps into to set one property. */
export function statusStep(
  identifiers: string[],
  bootstrap: BootstrapData,
): PaletteStep {
  const issues = identifiers.map((identifier) => loadedIssue(identifier));
  const teamId = issues[0]?.teamId ?? "";
  return {
    id: "status",
    title: "Set status",
    placeholder: "Change status to…",
    entries: () =>
      stateOptions(teamStates(bootstrap, teamId)).map((option) => ({
        id: `status:${option.value}`,
        label: option.label,
        icon: option.icon,
        section: "Status",
        checked: issues.every((issue) => issue.state.name === option.value),
        run: () => {
          applyChange(identifiers, { kind: "state", stateName: option.value });
        },
      })),
  };
}

export function priorityStep(identifiers: string[]): PaletteStep {
  return {
    id: "priority",
    title: "Set priority",
    placeholder: "Change priority to…",
    entries: () =>
      priorityOptions.map((option) => ({
        id: `priority:${option.value}`,
        label: option.label,
        icon: option.icon,
        section: "Priority",
        checked: identifiers.every(
          (identifier) =>
            String(loadedIssue(identifier).priority) === option.value,
        ),
        run: () => {
          applyChange(identifiers, {
            kind: "priority",
            priority: Number(option.value),
          });
        },
      })),
  };
}

export function assigneeStep(
  identifiers: string[],
  bootstrap: BootstrapData,
): PaletteStep {
  return {
    id: "assignee",
    title: "Assign to",
    placeholder: "Assign to…",
    entries: () => {
      const assignees = identifiers.map(
        (identifier) => loadedIssue(identifier).assignee?.key ?? null,
      );
      const is = (key: string | null) =>
        assignees.every((value) => value === key);
      // Every session is listed: the palette filters as you type.
      const actors = groupActors(bootstrap.actors, {
        query: "",
        expanded: new Set(
          bootstrap.actors.map((actor) => actorNamespace(actor)),
        ),
      }).flatMap((group) => group.actors);
      return [
        {
          id: "assignee:none",
          label: "Unassigned",
          icon: <span className="unassigned" aria-hidden="true" />,
          section: "Assignee",
          checked: is(null),
          run: () => {
            applyChange(identifiers, { kind: "assignee", assigneeKey: null });
          },
        },
        ...actors.map((actor) => ({
          id: `assignee:${actor.key}`,
          label: `${actor.name} · ${actor.key}`,
          icon: <Avatar actor={actor} decorative />,
          section: "Assignee",
          checked: is(actor.key),
          run: () => {
            applyChange(identifiers, {
              kind: "assignee",
              assigneeKey: actor.key,
            });
          },
        })),
      ];
    },
  };
}

export function labelStep(
  identifiers: string[],
  bootstrap: BootstrapData,
): PaletteStep {
  return {
    id: "labels",
    title: "Labels",
    placeholder: "Toggle labels…",
    entries: () => {
      const issues = identifiers.map((identifier) => loadedIssue(identifier));
      const teamId = issues[0]?.teamId ?? "";
      return bootstrap.labels
        .filter((label) => label.teamId === teamId)
        .map((label) => ({
          id: `label:${label.id}`,
          label: label.name,
          icon: <Swatch color={label.color} />,
          section: "Labels",
          stay: true,
          checked: issues.every((issue) =>
            issue.labels.some(({ name }) => name === label.name),
          ),
          run: () => {
            applyChange(identifiers, bulkLabelChange(issues, label.name));
          },
        }));
    },
  };
}

export function projectStep(
  identifiers: string[],
  bootstrap: BootstrapData,
): PaletteStep {
  return {
    id: "project",
    title: "Move to project",
    placeholder: "Move to project…",
    entries: () => {
      const slugs = identifiers.map(
        (identifier) => loadedIssue(identifier).project?.slug ?? null,
      );
      const is = (slug: string | null) =>
        slugs.every((value) => value === slug);
      return [
        {
          id: "project:none",
          label: "No project",
          icon: <Folder size={15} />,
          section: "Project",
          checked: is(null),
          run: () => {
            applyChange(identifiers, { kind: "project", projectSlug: null });
          },
        },
        ...bootstrap.projects
          .filter(({ archivedAt }) => archivedAt === null)
          .map((project) => ({
            id: `project:${project.slug}`,
            label: project.name,
            icon: <Swatch color={project.color} />,
            section: "Project",
            checked: is(project.slug),
            run: () => {
              applyChange(identifiers, {
                kind: "project",
                projectSlug: project.slug,
              });
            },
          })),
      ];
    },
  };
}
