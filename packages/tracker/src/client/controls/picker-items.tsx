import type { ReactNode } from "react";
import { ChevronsUpDown, FolderX, Plus, UserRoundX } from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { Avatar, Swatch } from "#client/ui/ui.tsx";
import { groupActors, matchesQuery } from "./actor-order.ts";

export type SearchPickerKind = "assignee" | "labels" | "project";

/** One row of a searchable picker. */
export type PickerItem = {
  id: string;
  /** `more` unfolds a harness's sessions; `create` makes the typed label. */
  kind: "value" | "more" | "create";
  /** Actor key, label name or project slug; null clears the property. */
  value: string | null;
  label: string;
  icon?: ReactNode;
  detail?: string;
};
export type PickerGroup = { value: string; label: string; items: PickerItem[] };

type Context = {
  bootstrap: BootstrapData;
  teamId: string;
  query: string;
  expanded: ReadonlySet<string>;
};

const matches = (text: string, query: string) =>
  text.toLowerCase().includes(query.trim().toLowerCase());

function assigneeGroups({ bootstrap, query, expanded }: Context) {
  const me = currentActor();
  const candidates: PickerItem[] = [
    {
      id: "me",
      kind: "value",
      value: me.key,
      label: "Assign to me",
      icon: <Avatar actor={me} decorative />,
      detail: me.name,
    },
    {
      id: "none",
      kind: "value",
      value: null,
      label: "Unassigned",
      icon: <UserRoundX size={16} aria-hidden="true" />,
    },
  ];
  const top = candidates.filter(
    (item) =>
      matches(item.label, query) ||
      (item.id === "me" && matchesQuery(me, query)),
  );
  const groups: PickerGroup[] = groupActors(
    bootstrap.actors.filter(({ key }) => key !== me.key),
    { query, expanded },
  ).map((group) => ({
    value: group.key,
    label: group.label,
    items: [
      ...group.actors.map((actor) => ({
        id: `actor:${actor.key}`,
        kind: "value" as const,
        value: actor.key,
        label: actor.name,
        icon: <Avatar actor={actor} decorative />,
        detail:
          actor.kind === "human"
            ? actor.key
            : actor.key.slice(group.key.length + 1),
      })),
      ...(group.hidden === 0
        ? []
        : [
            {
              id: `more:${group.key}`,
              kind: "more" as const,
              value: group.key,
              label: `${String(group.hidden)} more ${group.label} ${group.hidden === 1 ? "session" : "sessions"}`,
              icon: <ChevronsUpDown size={16} aria-hidden="true" />,
            },
          ]),
    ],
  }));
  return [
    ...(top.length === 0 ? [] : [{ value: "top", label: "", items: top }]),
    ...groups,
  ];
}

function labelGroups(
  { bootstrap, teamId, query }: Context,
  canCreate: boolean,
): PickerGroup[] {
  const labels = bootstrap.labels.filter((label) => label.teamId === teamId);
  const items: PickerItem[] = labels
    .filter((label) => matches(label.name, query))
    .map((label) => ({
      id: `label:${label.id}`,
      kind: "value",
      value: label.name,
      label: label.name,
      icon: <Swatch color={label.color} />,
    }));
  const typed = query.trim();
  if (
    canCreate &&
    typed !== "" &&
    !labels.some((label) => label.name.toLowerCase() === typed.toLowerCase())
  ) {
    items.push({
      id: "create",
      kind: "create",
      value: typed,
      label: `Create label “${typed}”`,
      icon: <Plus size={16} aria-hidden="true" />,
    });
  }
  return [{ value: "labels", label: "", items }];
}

function projectGroups({ bootstrap, query }: Context): PickerGroup[] {
  const candidates: PickerItem[] = [
    {
      id: "none",
      kind: "value",
      value: null,
      label: "No project",
      icon: <FolderX size={16} aria-hidden="true" />,
    },
    ...bootstrap.projects
      .filter(({ archivedAt }) => archivedAt === null)
      .map((project) => ({
        id: `project:${project.id}`,
        kind: "value" as const,
        value: project.slug,
        label: project.name,
        icon: <Swatch color={project.color} />,
      })),
  ];
  const items = candidates.filter((item) => matches(item.label, query));
  return [{ value: "projects", label: "", items }];
}

/** The rows a picker of this kind shows for the typed query. */
export function pickerGroups(
  kind: SearchPickerKind,
  context: Context,
  canCreate: boolean,
): PickerGroup[] {
  const groups =
    kind === "assignee"
      ? assigneeGroups(context)
      : kind === "labels"
        ? labelGroups(context, canCreate)
        : projectGroups(context);
  return groups.filter((group) => group.items.length > 0);
}

export const pickerPlaceholder: Record<SearchPickerKind, string> = {
  assignee: "Assign to…",
  labels: "Add labels…",
  project: "Move to project…",
};
