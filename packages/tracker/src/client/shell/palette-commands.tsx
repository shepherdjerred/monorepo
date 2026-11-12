import type { ReactNode } from "react";
import {
  Activity,
  Archive,
  CalendarClock,
  CircleDashed,
  Copy,
  Folder,
  FolderInput,
  GitBranch,
  GitFork,
  Keyboard,
  LayoutGrid,
  Link2,
  List,
  ListFilter,
  ListPlus,
  Monitor,
  Moon,
  Palette as PaletteIcon,
  Pencil,
  Plus,
  Settings2,
  SignalHigh,
  SquarePlus,
  Sun,
  Tag,
  ThumbsUp,
  Unlink,
  UserRound,
  UserRoundCheck,
  Users,
} from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import {
  assignToMe,
  copyBranchNames,
  copyIds,
  copyLinks,
  toggleArchived,
} from "#client/controls/issue-actions.ts";
import type { IssuePrefill } from "#client/issues/issue-form.tsx";
import { applyTheme, savedTheme, type Theme } from "#client/ui/theme.ts";
import { revealTheme } from "#client/feedback/motion.ts";
import type { Targets } from "./shell-actions.ts";
import { shortcutKeys } from "./shortcuts.ts";
import { rememberTeam } from "./team.ts";
import type { PaletteEntry } from "./palette-steps.tsx";
import { dueStep } from "#client/due/due-step.tsx";
import { parentStep } from "#client/hierarchy/parent-step.tsx";
import { currentActor } from "#client/data/identity.ts";
import { loadedIssue } from "#client/data/mutations.ts";
import {
  removeParent,
  requestSubIssue,
} from "#client/hierarchy/hierarchy-actions.ts";
import { ViewIcon } from "#client/saved-views/view-icons.tsx";
import { viewUrl, type SavedView } from "#client/saved-views/view-params.ts";
import {
  assigneeStep,
  labelStep,
  priorityStep,
  projectStep,
  statusStep,
} from "./palette-steps.tsx";

export type PaletteContext = {
  bootstrap: BootstrapData;
  targets: Targets | undefined;
  action: (name: string) => void;
  navigate: (to: string) => void;
  create: (prefill?: IssuePrefill) => void;
  prefill: IssuePrefill;
  views: readonly SavedView[];
  teamKey: string;
};

/** Due date and hierarchy commands for the issues an action applies to. */
function planningEntries(
  identifiers: string[],
  section: string,
): PaletteEntry[] {
  const [only] = identifiers;
  return [
    {
      id: "due",
      label: "Set due date…",
      icon: <CalendarClock size={15} />,
      hint: shortcutKeys("D"),
      section,
      step: dueStep(identifiers),
    },
    {
      id: "parent",
      label: "Set parent…",
      icon: <GitFork size={15} />,
      section,
      step: parentStep(identifiers),
    },
    ...(only !== undefined && identifiers.length === 1
      ? [
          {
            id: "sub-issue",
            label: "Add sub-issue",
            icon: <ListPlus size={15} />,
            hint: shortcutKeys("O"),
            section,
            run: () => {
              requestSubIssue(only);
            },
          },
        ]
      : []),
    ...(identifiers.some(
      (identifier) => loadedIssue(identifier).parent !== null,
    )
      ? [
          {
            id: "remove-parent",
            label: "Remove parent",
            icon: <Unlink size={15} />,
            section,
            run: () => {
              removeParent(identifiers);
            },
          },
        ]
      : []),
  ];
}

/** "Go to view …" for each saved view, with its G n shortcut. */
function viewEntries(context: PaletteContext): PaletteEntry[] {
  const me = currentActor().key;
  return context.views.map((view, index) => ({
    id: `view:${view.id}`,
    label: `Go to view ${view.name}`,
    icon: <ViewIcon name={view.icon} />,
    hint: index < 9 ? shortcutKeys(`view${String(index + 1)}`) : undefined,
    section: "Views",
    run: () => {
      context.navigate(viewUrl(view, { teamKey: context.teamKey, me }));
    },
  }));
}

/** Commands for the open issue, the selection or the focused row. */
function issueEntries(context: PaletteContext): PaletteEntry[] {
  const { targets, bootstrap } = context;
  if (targets === undefined) {
    return [];
  }
  const { identifiers } = targets;
  const section =
    identifiers.length === 1
      ? (identifiers[0] ?? "Issue")
      : `${String(identifiers.length)} selected issues`;
  const writes: PaletteEntry[] = bootstrap.writesEnabled
    ? [
        {
          id: "set-status",
          label: "Set status…",
          icon: <CircleDashed size={15} />,
          hint: shortcutKeys("s"),
          section,
          step: statusStep(identifiers, bootstrap),
        },
        {
          id: "set-priority",
          label: "Set priority…",
          icon: <SignalHigh size={15} />,
          hint: shortcutKeys("p"),
          section,
          step: priorityStep(identifiers),
        },
        {
          id: "assign",
          label: "Assign to…",
          icon: <UserRound size={15} />,
          hint: shortcutKeys("a"),
          section,
          step: assigneeStep(identifiers, bootstrap),
        },
        {
          id: "assign-me",
          label: "Assign to me",
          icon: <UserRoundCheck size={15} />,
          hint: shortcutKeys("i"),
          section,
          run: () => {
            assignToMe(identifiers);
          },
        },
        {
          id: "labels",
          label: "Change labels…",
          icon: <Tag size={15} />,
          hint: shortcutKeys("l"),
          section,
          step: labelStep(identifiers, bootstrap),
        },
        {
          id: "project",
          label: "Move to project…",
          icon: <FolderInput size={15} />,
          hint: shortcutKeys("P"),
          section,
          step: projectStep(identifiers, bootstrap),
        },
        ...planningEntries(identifiers, section),
        {
          id: "archive",
          label: "Archive or unarchive",
          icon: <Archive size={15} />,
          section,
          run: () => {
            toggleArchived(identifiers);
          },
        },
      ]
    : [];
  const single: PaletteEntry[] =
    targets.where === "issue" && bootstrap.writesEnabled
      ? [
          {
            id: "vote",
            label: "Vote",
            icon: <ThumbsUp size={15} />,
            hint: shortcutKeys("v"),
            section,
            run: () => {
              context.action("v");
            },
          },
          {
            id: "edit-description",
            label: "Edit description",
            icon: <Pencil size={15} />,
            hint: shortcutKeys("e"),
            section,
            run: () => {
              context.action("e");
            },
          },
        ]
      : [];
  return [
    ...writes,
    ...single,
    {
      id: "copy-id",
      label: identifiers.length === 1 ? "Copy ID" : "Copy IDs",
      icon: <Copy size={15} />,
      hint: shortcutKeys("copyId"),
      section,
      run: () => {
        copyIds(identifiers);
      },
    },
    {
      id: "copy-link",
      label: identifiers.length === 1 ? "Copy link" : "Copy links",
      icon: <Link2 size={15} />,
      hint: shortcutKeys("copyLink"),
      section,
      run: () => {
        copyLinks(identifiers);
      },
    },
    {
      id: "copy-branch",
      label:
        identifiers.length === 1 ? "Copy branch name" : "Copy branch names",
      icon: <GitBranch size={15} />,
      section,
      run: () => {
        copyBranchNames(identifiers);
      },
    },
  ];
}

const pages = [
  ["Issues", "/issues", <List size={15} key="icon" />, "gi"],
  ["Board", "/board", <LayoutGrid size={15} key="icon" />, "gb"],
  ["Projects", "/projects", <Folder size={15} key="icon" />, "gp"],
  ["Actors", "/actors", <Users size={15} key="icon" />, undefined],
  ["Activity", "/activity", <Activity size={15} key="icon" />, "ga"],
  ["Settings", "/settings", <Settings2 size={15} key="icon" />, undefined],
] as const;

const themes: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: "system", label: "System", icon: <Monitor size={15} /> },
  { value: "light", label: "Light", icon: <Sun size={15} /> },
  { value: "dark", label: "Dark", icon: <Moon size={15} /> },
];

function workspaceEntries(context: PaletteContext): PaletteEntry[] {
  const { bootstrap } = context;
  return [
    {
      id: "create",
      label: "Create issue",
      icon: <Plus size={15} />,
      hint: shortcutKeys("c"),
      section: "Commands",
      run: () => {
        context.create();
      },
    },
    {
      id: "create-here",
      label: "Create issue in this view",
      icon: <SquarePlus size={15} />,
      hint: shortcutKeys("C"),
      section: "Commands",
      run: () => {
        context.create(context.prefill);
      },
    },
    {
      id: "filter",
      label: "Filter issues…",
      icon: <ListFilter size={15} />,
      hint: shortcutKeys("f"),
      section: "Commands",
      run: () => {
        context.action("f");
      },
    },
    {
      id: "mine",
      label: "My issues",
      icon: <UserRoundCheck size={15} />,
      hint: shortcutKeys("gm"),
      section: "Commands",
      run: () => {
        context.navigate("/issues?mine=true");
      },
    },
    {
      id: "team",
      label: "Switch team…",
      icon: <Users size={15} />,
      section: "Commands",
      step: {
        id: "team",
        title: "Switch team",
        placeholder: "Switch to team…",
        entries: () =>
          bootstrap.teams.map((team) => ({
            id: `team:${team.key}`,
            label: `${team.name} · ${team.key}`,
            icon: <span className="team-icon">{team.key}</span>,
            section: "Teams",
            checked: context.prefill.teamKey === team.key,
            run: () => {
              rememberTeam(team.key);
              context.navigate(`/issues?team=${team.key}`);
            },
          })),
      },
    },
    {
      id: "theme",
      label: "Change theme…",
      icon: <PaletteIcon size={15} />,
      section: "Commands",
      step: {
        id: "theme",
        title: "Theme",
        placeholder: "Change theme to…",
        entries: () =>
          themes.map((theme) => ({
            id: `theme:${theme.value}`,
            label: theme.label,
            icon: theme.icon,
            section: "Theme",
            checked: savedTheme() === theme.value,
            run: () => {
              // Chosen from the keyboard: the theme spreads from the top.
              revealTheme(
                () => {
                  applyTheme(theme.value);
                },
                { x: globalThis.innerWidth / 2, y: 0 },
              );
            },
          })),
      },
    },
    {
      id: "help",
      label: "Keyboard shortcuts",
      icon: <Keyboard size={15} />,
      hint: shortcutKeys("?"),
      section: "Commands",
      run: () => {
        context.action("?");
      },
    },
    ...pages.map(([name, path, icon, shortcut]) => ({
      id: `go:${path}`,
      label: `Go to ${name.toLowerCase()}`,
      icon,
      hint: shortcut === undefined ? undefined : shortcutKeys(shortcut),
      section: "Navigation",
      run: () => {
        context.navigate(path);
      },
    })),
  ];
}

export function rootEntries(context: PaletteContext): PaletteEntry[] {
  return [
    ...issueEntries(context),
    ...workspaceEntries(context),
    ...viewEntries(context),
  ];
}
