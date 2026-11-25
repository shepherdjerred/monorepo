import type { ReactNode, RefObject } from "react";
import {
  BoxesIcon,
  CpuIcon,
  DatabaseIcon,
  GitPullRequestIcon,
  LayersIcon,
  PackageCheckIcon,
  type LucideIcon,
} from "lucide-react";
import {
  AppSwitcher,
  Field,
  HeaderBar,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  ThemeRow,
  type SidebarLinkProps,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import type { NamespaceCounts, NamespaceFilter } from "./types.ts";

export const SWITCHER_CURRENT = { label: "CI cache", mark: "cc" } as const;

export const NAMESPACE_OPTIONS: readonly {
  readonly value: NamespaceFilter;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { value: "overview", label: "Overview", icon: LayersIcon },
  { value: "turbo-main", label: "Turbo (main)", icon: PackageCheckIcon },
  { value: "turbo-pr", label: "Turbo (PR)", icon: GitPullRequestIcon },
  { value: "gradle", label: "Gradle", icon: BoxesIcon },
  { value: "sccache-main", label: "sccache (main)", icon: CpuIcon },
  { value: "sccache-pr", label: "sccache (PR)", icon: DatabaseIcon },
];

export function parseNamespaceFilter(raw: string | null): NamespaceFilter {
  const match = NAMESPACE_OPTIONS.find((item) => item.value === raw);
  return match?.value ?? "overview";
}

export function namespaceFilterLabel(filter: NamespaceFilter): string {
  return (
    NAMESPACE_OPTIONS.find((item) => item.value === filter)?.label ?? "Overview"
  );
}

function SwitcherForCiCache() {
  return (
    <AppSwitcher
      current={SWITCHER_CURRENT}
      apps={CONSOLE_LINKS.map(({ label, url, group }) => ({
        label,
        url,
        group,
      }))}
    />
  );
}

function NamespaceButton({
  className,
  "aria-current": ariaCurrent,
  children,
  onSelect,
}: SidebarLinkProps & { onSelect: () => void }) {
  return (
    <button
      type="button"
      className={className}
      aria-current={ariaCurrent}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

export function NamespacesSidebar({
  counts,
  selected,
  theme,
  onSelect,
}: {
  counts: NamespaceCounts;
  selected: NamespaceFilter;
  theme: ThemeStore;
  onSelect: (next: NamespaceFilter) => void;
}) {
  return (
    <Sidebar
      top={<SwitcherForCiCache />}
      navLabel="CI cache namespaces"
      footer={<ThemeRow store={theme} />}
    >
      <SidebarGroup label="Namespaces">
        {NAMESPACE_OPTIONS.map((option) => (
          <SidebarItem
            key={option.value}
            href={option.value === "overview" ? "/" : `/?ns=${option.value}`}
            label={option.label}
            icon={option.icon}
            count={counts[option.value]}
            current={selected === option.value}
            renderLink={(props) => (
              <NamespaceButton
                {...props}
                onSelect={() => {
                  onSelect(option.value);
                }}
              />
            )}
          />
        ))}
      </SidebarGroup>
    </Sidebar>
  );
}

/** Below 900px the sidebar hides; keep switcher, namespace filter, and theme row accessible. */
export function MobileBar({
  counts,
  selected,
  theme,
  onSelect,
}: {
  counts: NamespaceCounts;
  selected: NamespaceFilter;
  theme: ThemeStore;
  onSelect: (next: NamespaceFilter) => void;
}) {
  return (
    <div className="ci-cache-mobile-bar">
      <SwitcherForCiCache />
      <Field label="Namespace" layout="inline">
        {(control) => (
          <select
            {...control}
            value={selected}
            onChange={(event) => {
              onSelect(parseNamespaceFilter(event.target.value));
            }}
          >
            {NAMESPACE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({String(counts[option.value])})
              </option>
            ))}
          </select>
        )}
      </Field>
      <ThemeRow store={theme} />
    </div>
  );
}

export function CacheHeader({
  selected,
  query,
  searchInputRef,
  onQueryChange,
}: {
  selected: NamespaceFilter;
  query: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (next: string) => void;
}): ReactNode {
  const scopeLabel = namespaceFilterLabel(selected);
  return (
    <HeaderBar
      title="CI cache"
      meta={selected === "overview" ? "Turbo · Gradle · sccache" : scopeLabel}
      actions={
        <>
          <search
            aria-label="Filter cache namespaces and keys"
            className="ci-cache-search"
          >
            <form
              action="/"
              method="get"
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <Field label="Filter" layout="inline">
                {(control) => (
                  <input
                    {...control}
                    ref={searchInputRef}
                    name="q"
                    type="search"
                    value={query}
                    placeholder="Key, hash or namespace (/)"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="search"
                    onChange={(event) => {
                      onQueryChange(event.target.value);
                    }}
                  />
                )}
              </Field>
            </form>
          </search>
          <span className="ui-chip">Read-only</span>
        </>
      }
    />
  );
}
