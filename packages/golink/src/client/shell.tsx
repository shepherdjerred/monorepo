import type { ReactNode, RefObject } from "react";
import { CommandIcon, PlusIcon } from "lucide-react";
import {
  AppSwitcher,
  Button,
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
import {
  KIND_FILTER_OPTIONS,
  type KindCounts,
  type KindFilter,
} from "./directory-sections.tsx";

const SWITCHER_CURRENT = { label: "Go links", mark: "go" } as const;

function SwitcherForGolink() {
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

/** A source row is a filter, not a page: a button that reports `aria-current`. */
function SourceButton({
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

export function SourcesSidebar({
  counts,
  shortcutCount,
  kindFilter,
  theme,
  onKindFilterChange,
}: {
  counts: KindCounts;
  shortcutCount: number;
  kindFilter: KindFilter;
  theme: ThemeStore;
  onKindFilterChange: (next: KindFilter) => void;
}) {
  return (
    <Sidebar
      top={<SwitcherForGolink />}
      navLabel="Go links"
      footer={<ThemeRow store={theme} />}
    >
      <SidebarGroup label="Sources">
        {KIND_FILTER_OPTIONS.map((option) => (
          <SidebarItem
            key={option.value}
            href={`#${option.value}`}
            label={option.label}
            icon={option.icon}
            count={counts[option.value]}
            current={kindFilter === option.value}
            renderLink={(props) => (
              <SourceButton
                {...props}
                onSelect={() => {
                  onKindFilterChange(option.value);
                }}
              />
            )}
          />
        ))}
      </SidebarGroup>
      {shortcutCount > 0 && (
        <SidebarGroup label="Reference">
          <SidebarItem
            href="#shortcuts"
            label="Shortcuts"
            icon={CommandIcon}
            count={shortcutCount}
          />
        </SidebarGroup>
      )}
    </Sidebar>
  );
}

/** Below 900px the sidebar is hidden; this bar keeps the switcher and the filter. */
export function MobileBar({
  kindFilter,
  counts,
  onKindFilterChange,
}: {
  kindFilter: KindFilter;
  counts: KindCounts;
  onKindFilterChange: (next: KindFilter) => void;
}) {
  return (
    <div className="golink-mobile-bar">
      <SwitcherForGolink />
      <Field label="Source" layout="inline">
        {(control) => (
          <select
            {...control}
            value={kindFilter}
            onChange={(event) => {
              const next = KIND_FILTER_OPTIONS.find(
                (option) => option.value === event.target.value,
              );
              if (next !== undefined) {
                onKindFilterChange(next.value);
              }
            }}
          >
            {KIND_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({String(counts[option.value])})
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}

export function GolinkHeader({
  query,
  searchInputRef,
  viewerLogin,
  writesEnabled,
  onQueryChange,
  onNewLink,
}: {
  query: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  viewerLogin: string | null;
  writesEnabled: boolean;
  onQueryChange: (next: string) => void;
  onNewLink: () => void;
}): ReactNode {
  return (
    <HeaderBar
      title="Go links"
      meta={viewerLogin ?? undefined}
      actions={
        <>
          <search aria-label="Filter go links" className="golink-search">
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
                    placeholder="Name, host or service (/)"
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
          {writesEnabled ? (
            <Button variant="primary" onClick={onNewLink}>
              <PlusIcon aria-hidden />
              New link
            </Button>
          ) : (
            <span className="ui-chip">Read-only</span>
          )}
        </>
      }
    />
  );
}
