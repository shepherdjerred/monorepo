import {
  nextThemePreference,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import {
  ActivityIcon,
  AlertCircleIcon,
  ExternalLinkIcon,
  FolderIcon,
  FolderKeyIcon,
  RotateCcwIcon,
  SunMoonIcon,
  TagIcon,
  type LucideIcon,
} from "lucide-react";
import type { IssueListItem, ProjectSummary } from "#shared/contract.ts";

export type PaletteItem = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string | undefined;
  readonly keywords: string;
  readonly icon: LucideIcon;
  readonly run: (navigate: (to: string) => void) => void;
};

export type PaletteSection = {
  readonly heading: string;
  readonly items: readonly PaletteItem[];
};

export function matchesQuery(
  item: PaletteItem,
  normalizedTerm: string,
): boolean {
  if (normalizedTerm.length === 0) {
    return true;
  }
  const haystack =
    `${item.label} ${item.detail ?? ""} ${item.keywords}`.toLowerCase();
  return normalizedTerm
    .split(/\s+/u)
    .every((token) => haystack.includes(token));
}

export function buildStaticSections(
  projects: readonly ProjectSummary[],
  store: ThemeStore,
  preference: string,
): readonly PaletteSection[] {
  const triageItems: readonly PaletteItem[] = [
    {
      id: "nav-overview",
      label: "Overview",
      detail: "/",
      keywords: "home dashboard summary attention",
      icon: ActivityIcon,
      run: (navigate) => {
        navigate("/");
      },
    },
    {
      id: "nav-unresolved",
      label: "Unresolved issues",
      detail: "/issues",
      keywords: "inbox open triage errors bugs",
      icon: AlertCircleIcon,
      run: (navigate) => {
        navigate("/issues");
      },
    },
    {
      id: "nav-regressed",
      label: "Regressed issues",
      detail: "/issues?tab=regressed",
      keywords: "regressions reopened",
      icon: RotateCcwIcon,
      run: (navigate) => {
        navigate("/issues?tab=regressed");
      },
    },
    {
      id: "nav-releases",
      label: "Releases",
      detail: "/releases",
      keywords: "versions deploys tags",
      icon: TagIcon,
      run: (navigate) => {
        navigate("/releases");
      },
    },
    {
      id: "nav-projects",
      label: "Projects & DSNs",
      detail: "/projects",
      keywords: "dsn keys ingest retention alerts settings",
      icon: FolderKeyIcon,
      run: (navigate) => {
        navigate("/projects");
      },
    },
  ];

  const projectItems: readonly PaletteItem[] = projects.map((project) => ({
    id: `project-${project.slug}`,
    label: project.name,
    detail: `${project.slug} · ${String(project.unresolvedCount)} open`,
    keywords: `project ${project.slug} ${project.name}`,
    icon: FolderIcon,
    run: (navigate) => {
      navigate(`/projects/${encodeURIComponent(project.slug)}`);
    },
  }));

  const nextTheme = nextThemePreference(store.getPreference());
  const commandItems: readonly PaletteItem[] = [
    {
      id: "cmd-theme",
      label: `Cycle theme (${preference} → ${nextTheme})`,
      detail: "Appearance",
      keywords: "theme dark light system mode color",
      icon: SunMoonIcon,
      run: () => {
        store.setThemePreference(nextThemePreference(store.getPreference()));
      },
    },
  ];

  const consoleItems: readonly PaletteItem[] = CONSOLE_LINKS.map((link) => ({
    id: `console-${link.id}`,
    label: `Open ${link.label}`,
    detail: link.group,
    keywords: `console app tool ${link.id} ${link.label} ${link.group}`,
    icon: ExternalLinkIcon,
    run: () => {
      globalThis.location.assign(link.url);
    },
  }));

  return [
    { heading: "Triage", items: triageItems },
    ...(projectItems.length > 0
      ? [{ heading: "Projects", items: projectItems }]
      : []),
    { heading: "Commands", items: commandItems },
    { heading: "Consoles", items: consoleItems },
  ];
}

export function issueToPaletteItem(issue: IssueListItem): PaletteItem {
  const headline =
    issue.value.length > 0 ? `${issue.type}: ${issue.value}` : issue.type;
  return {
    id: `issue-${issue.id}`,
    label: headline,
    detail: issue.projectSlug,
    keywords: `${issue.type} ${issue.value} ${issue.projectSlug} ${issue.primaryFingerprint}`,
    icon: AlertCircleIcon,
    run: (navigate) => {
      navigate(`/issues/${encodeURIComponent(issue.id)}`);
    },
  };
}
