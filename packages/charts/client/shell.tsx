import {
  FileCode2Icon,
  GlobeIcon,
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
import type { CatalogCounts, CatalogFilter } from "./model.ts";

const SWITCHER_CURRENT = { label: "Charts", mark: "ch" } as const;

export const CATALOG_FILTER_OPTIONS: readonly {
  readonly value: CatalogFilter;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { value: "all", label: "All", icon: LayersIcon },
  { value: "first-party", label: "First-party", icon: PackageCheckIcon },
  { value: "upstream", label: "Upstream mirrors", icon: GlobeIcon },
];

function SwitcherForCharts(): React.JSX.Element {
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

function FilterButton({
  className,
  "aria-current": ariaCurrent,
  children,
  onSelect,
}: SidebarLinkProps & { readonly onSelect: () => void }): React.JSX.Element {
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

export function ChartsSidebar({
  counts,
  filter,
  theme,
  onFilterChange,
}: {
  readonly counts: CatalogCounts;
  readonly filter: CatalogFilter;
  readonly theme: ThemeStore;
  readonly onFilterChange: (next: CatalogFilter) => void;
}): React.JSX.Element {
  return (
    <Sidebar
      top={<SwitcherForCharts />}
      navLabel="Charts catalog"
      footer={<ThemeRow store={theme} />}
    >
      <SidebarGroup label="Catalog">
        {CATALOG_FILTER_OPTIONS.map((option) => (
          <SidebarItem
            key={option.value}
            href={option.value === "all" ? "/" : `/?kind=${option.value}`}
            label={option.label}
            icon={option.icon}
            count={counts[option.value]}
            current={filter === option.value}
            renderLink={(props) => (
              <FilterButton
                {...props}
                onSelect={() => {
                  onFilterChange(option.value);
                }}
              />
            )}
          />
        ))}
      </SidebarGroup>
      <SidebarGroup label="Repository">
        <SidebarItem
          href="/index.yaml"
          label="Helm index.yaml"
          icon={FileCode2Icon}
        />
      </SidebarGroup>
    </Sidebar>
  );
}

/** Below 900px the sidebar hides; this bar preserves app switching, filter, and theme. */
export function MobileBar({
  filter,
  counts,
  theme,
  onFilterChange,
}: {
  readonly filter: CatalogFilter;
  readonly counts: CatalogCounts;
  readonly theme: ThemeStore;
  readonly onFilterChange: (next: CatalogFilter) => void;
}): React.JSX.Element {
  return (
    <div className="ch-mobile-bar">
      <SwitcherForCharts />
      <Field label="Catalog" layout="inline">
        {(control) => (
          <select
            {...control}
            value={filter}
            onChange={(event) => {
              const matched = CATALOG_FILTER_OPTIONS.find(
                (option) => option.value === event.target.value,
              );
              if (matched !== undefined) {
                onFilterChange(matched.value);
              }
            }}
          >
            {CATALOG_FILTER_OPTIONS.map((option) => (
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

export function ChartsHeader({
  catalogRevision,
}: {
  readonly catalogRevision: number | null;
}): React.JSX.Element {
  return (
    <HeaderBar
      title="Charts"
      {...(catalogRevision === null
        ? {}
        : { meta: `Revision ${String(catalogRevision)}` })}
      actions={
        <>
          <span className="ui-chip">Read-only</span>
          <a className="ui-btn" href="/index.yaml">
            <FileCode2Icon aria-hidden="true" />
            index.yaml
          </a>
        </>
      }
    />
  );
}
