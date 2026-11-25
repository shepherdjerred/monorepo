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
import {
  parseCatalogFilter,
  type CatalogCounts,
  type CatalogFilter,
} from "./model.ts";

const SWITCHER_CURRENT = { label: "Charts", mark: "ch" } as const;
const SWITCHER_APPS = CONSOLE_LINKS.map(({ label, url, group }) => ({
  label,
  url,
  group,
}));

export const CATALOG_FILTER_OPTIONS: readonly {
  readonly value: CatalogFilter;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { value: "all", label: "All", icon: LayersIcon },
  { value: "first-party", label: "First-party", icon: PackageCheckIcon },
  { value: "upstream", label: "Upstream mirrors", icon: GlobeIcon },
];

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
      top={<AppSwitcher current={SWITCHER_CURRENT} apps={SWITCHER_APPS} />}
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

function renderCatalogOption(
  value: CatalogFilter,
  label: string,
  count: number,
): React.JSX.Element {
  return (
    <option key={value} value={value}>
      {`${label} (${String(count)})`}
    </option>
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
  const options = CATALOG_FILTER_OPTIONS.map(({ value, label }) =>
    renderCatalogOption(value, label, counts[value]),
  );
  return (
    <div className="ch-mobile-bar">
      <AppSwitcher current={SWITCHER_CURRENT} apps={SWITCHER_APPS} />
      <Field label="Catalog" layout="inline">
        {(control) => (
          <select
            {...control}
            value={filter}
            onChange={(event) => {
              onFilterChange(parseCatalogFilter(event.target.value));
            }}
          >
            {options}
          </select>
        )}
      </Field>
      <ThemeRow store={theme} />
    </div>
  );
}
