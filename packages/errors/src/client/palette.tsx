import { Dialog } from "@base-ui/react/dialog";
import {
  nextThemePreference,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  AlertCircleIcon,
  CornerDownLeftIcon,
  ExternalLinkIcon,
  FolderIcon,
  FolderKeyIcon,
  RotateCcwIcon,
  SearchIcon,
  SunMoonIcon,
  TagIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import type { IssueListItem, ProjectSummary } from "#shared/contract.ts";
import { fetchIssues } from "./api.ts";
import {
  themeStore as defaultThemeStore,
  useThemePreference,
} from "./theme.ts";

const SEARCH_DEBOUNCE_MS = 180;
const LISTBOX_ID = "er-palette-listbox";

let paletteOpen = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPaletteOpen(): boolean {
  return paletteOpen;
}

function getServerPaletteOpen(): boolean {
  return false;
}

export function setPaletteOpen(next: boolean): void {
  if (paletteOpen === next) {
    return;
  }
  paletteOpen = next;
  for (const listener of listeners) {
    listener();
  }
}

export function isPaletteShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === "k" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", (event) => {
    if (!isPaletteShortcut(event)) {
      return;
    }
    event.preventDefault();
    setPaletteOpen(!paletteOpen);
  });
}

function optionId(index: number): string {
  return `er-palette-option-${String(index)}`;
}

function debounce(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timer);
        reject(new DOMException("Superseded by a newer query", "AbortError"));
      },
      { once: true },
    );
  });
}

type PaletteItem = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string | undefined;
  readonly keywords: string;
  readonly icon: LucideIcon;
  readonly run: (navigate: (to: string) => void) => void;
};

type PaletteSection = {
  readonly heading: string;
  readonly items: readonly PaletteItem[];
};

function matchesQuery(item: PaletteItem, normalizedTerm: string): boolean {
  if (normalizedTerm.length === 0) {
    return true;
  }
  const haystack =
    `${item.label} ${item.detail ?? ""} ${item.keywords}`.toLowerCase();
  return normalizedTerm
    .split(/\s+/u)
    .every((token) => haystack.includes(token));
}

function buildStaticSections(
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

function issueToPaletteItem(issue: IssueListItem): PaletteItem {
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

function PaletteBody({
  projects,
  store,
}: {
  readonly projects: readonly ProjectSummary[];
  readonly store: ThemeStore;
}): React.JSX.Element {
  const navigate = useNavigate();
  const preference = useThemePreference(store);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const term = query.trim();
  const normalizedTerm = term.toLowerCase();

  const issueSearch = useQuery({
    queryKey: ["palette-issues", term],
    queryFn: async ({ signal }) => {
      await debounce(SEARCH_DEBOUNCE_MS, signal);
      const result = await fetchIssues(
        { q: term, tab: "all", limit: 8 },
        signal,
      );
      return result.items;
    },
    enabled: term.length >= 2,
    retry: false,
  });

  const sections = useMemo(() => {
    const baseSections = buildStaticSections(projects, store, preference)
      .map((section) => ({
        heading: section.heading,
        items: section.items.filter((item) =>
          matchesQuery(item, normalizedTerm),
        ),
      }))
      .filter((section) => section.items.length > 0);

    const matchingIssues =
      term.length >= 2
        ? (issueSearch.data ?? []).map((issue) => issueToPaletteItem(issue))
        : [];
    if (matchingIssues.length === 0) {
      return baseSections;
    }
    return [
      { heading: "Matching issues", items: matchingIssues },
      ...baseSections,
    ];
  }, [issueSearch.data, normalizedTerm, preference, projects, store, term]);

  const items = sections.flatMap((section) => section.items);
  const active = items.length === 0 ? 0 : Math.min(selected, items.length - 1);

  const choose = (item: PaletteItem | undefined): void => {
    if (item === undefined) {
      return;
    }
    setPaletteOpen(false);
    globalThis.requestAnimationFrame(() => {
      item.run((to) => {
        void navigate(to);
      });
    });
  };

  const move = (step: 1 | -1): void => {
    if (items.length === 0) {
      return;
    }
    const next = (active + step + items.length) % items.length;
    setSelected(next);
    if (typeof document !== "undefined") {
      document
        .querySelector(`#${optionId(next)}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        move(1);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        move(-1);
        break;
      }
      case "Enter": {
        event.preventDefault();
        choose(items[active]);
        break;
      }
      default:
        break;
    }
  };

  const starts = sections.map((_, sectionIndex) =>
    sections
      .slice(0, sectionIndex)
      .reduce((count, section) => count + section.items.length, 0),
  );

  return (
    <>
      <div className="palette-search">
        <SearchIcon aria-hidden="true" />
        <input
          role="combobox"
          aria-label="Search and commands"
          aria-expanded="true"
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          {...(items.length === 0
            ? {}
            : { "aria-activedescendant": optionId(active) })}
          placeholder="Jump to project, search issues, or run a command…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="palette-results" id={LISTBOX_ID} role="listbox">
        {sections.map((section, sectionIndex) => (
          <div key={section.heading} role="group" aria-label={section.heading}>
            <p className="palette-heading" aria-hidden="true">
              {section.heading}
            </p>
            {section.items.map((item, position) => {
              const itemIndex = (starts[sectionIndex] ?? 0) + position;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  id={optionId(itemIndex)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={itemIndex === active}
                  className="palette-option"
                  onMouseMove={() => {
                    setSelected(itemIndex);
                  }}
                  onClick={() => {
                    choose(item);
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span className="palette-label">{item.label}</span>
                  {item.detail === undefined ? null : (
                    <span className="palette-detail">{item.detail}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        <p className="palette-status" role="status">
          {term.length >= 2 && issueSearch.isFetching
            ? "Searching issues…"
            : items.length === 0
              ? "No matching pages, projects, or issues."
              : ""}
        </p>
      </div>
      <div className="palette-footer" aria-hidden="true">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>
            <CornerDownLeftIcon />
          </kbd>{" "}
          open
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </>
  );
}

export function CommandPalette({
  projects,
  store = defaultThemeStore,
}: {
  readonly projects: readonly ProjectSummary[];
  readonly store?: ThemeStore | undefined;
}): React.JSX.Element {
  const open = useSyncExternalStore(
    subscribe,
    getPaletteOpen,
    getServerPaletteOpen,
  );
  return (
    <Dialog.Root open={open} onOpenChange={setPaletteOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="palette-backdrop" />
        <Dialog.Popup className="palette">
          <Dialog.Title className="ui-sr-only">
            Search and commands
          </Dialog.Title>
          <PaletteBody projects={projects} store={store} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
