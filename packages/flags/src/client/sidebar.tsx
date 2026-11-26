import { SearchIcon } from "lucide-react";
import {
  AppSwitcher,
  CommandPaletteButton,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  ThemeRow,
  TopBar,
  type SidebarLinkProps,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import { Link } from "react-router";
import {
  deploymentPath,
  sidebarEntries,
  splitDeploymentId,
  type Route,
  type SidebarEntry,
} from "./model.ts";
import { deploymentIcon, VIEWS, type View } from "./nav.ts";
import { PALETTE_LABEL, paletteStore } from "./palette.tsx";

const APPS = CONSOLE_LINKS.map(({ label, url, group }) => ({
  label,
  url,
  group,
}));

const CURRENT_APP = { label: "Flags", mark: "F" };
const NAV_LABEL = "Flags";

function hrefOf(id: string): string {
  const [catalog, stage] = id.split("/");
  return catalog === undefined || stage === undefined
    ? "/"
    : deploymentPath(catalog, stage);
}

/**
 * A sidebar row that navigates in the page instead of reloading it. The
 * drawer passes `onNavigate` so following a link closes it.
 */
function routerLink(onNavigate?: () => void) {
  return ({ href, ...props }: SidebarLinkProps): React.JSX.Element => (
    <Link
      to={href}
      {...props}
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
    />
  );
}

function countProps(
  counts: ReadonlyMap<string, number>,
  id: string,
): { count?: number } {
  const count = counts.get(id);
  return count === undefined ? {} : { count };
}

function isCurrent(route: Route | undefined, id: string): boolean {
  return route !== undefined && `${route.catalog}/${route.stage}` === id;
}

export type NavigationProps = {
  /** Deployment ids (`catalog/stage`) in the order the API lists them. */
  readonly ids: readonly string[] | undefined;
  readonly counts: ReadonlyMap<string, number>;
  readonly route: Route | undefined;
  /** The view on screen, outside a deployment. */
  readonly view?: View | undefined;
  /** Drifted items across every deployment, once the drift report loads. */
  readonly driftCount?: number | undefined;
  readonly status?: string | undefined;
  readonly failure?: string | undefined;
};

/** The views, then the deployments, as the sidebar and the drawer list them. */
function NavigationGroups({
  ids,
  counts,
  route,
  view,
  driftCount,
  status,
  failure,
  onNavigate,
}: NavigationProps & {
  readonly onNavigate?: () => void;
}): React.JSX.Element {
  const renderLink = routerLink(onNavigate);
  const entries: SidebarEntry[] = ids === undefined ? [] : sidebarEntries(ids);
  const singles = entries.filter((entry) => entry.kind === "single");
  const groups = entries.filter((entry) => entry.kind === "group");
  return (
    <>
      <SidebarGroup label="Views">
        {VIEWS.map((entry) => (
          <SidebarItem
            key={entry.view}
            href={entry.href}
            label={entry.label}
            icon={entry.icon}
            {...(driftCount !== undefined && entry.view === "drift"
              ? { count: driftCount }
              : {})}
            current={view === entry.view}
            renderLink={renderLink}
          />
        ))}
      </SidebarGroup>
      {status === undefined ? null : <p className="fl-note">{status}</p>}
      {failure === undefined ? null : (
        <p className="fl-note" role="alert">
          {failure}
        </p>
      )}
      {singles.length === 0 ? null : (
        <SidebarGroup label="Deployments">
          {singles.map((entry) => (
            <SidebarItem
              key={entry.id}
              href={hrefOf(entry.id)}
              label={entry.label}
              icon={deploymentIcon(splitDeploymentId(entry.id).stage)}
              {...countProps(counts, entry.id)}
              current={isCurrent(route, entry.id)}
              renderLink={renderLink}
            />
          ))}
        </SidebarGroup>
      )}
      {groups.map((entry) => (
        <SidebarGroup key={entry.catalog} label={entry.catalog}>
          {entry.stages.map((stage) => (
            <SidebarItem
              key={stage.id}
              href={hrefOf(stage.id)}
              label={stage.label}
              icon={deploymentIcon(splitDeploymentId(stage.id).stage)}
              {...countProps(counts, stage.id)}
              current={isCurrent(route, stage.id)}
              renderLink={renderLink}
            />
          ))}
        </SidebarGroup>
      ))}
    </>
  );
}

function Switcher(): React.JSX.Element {
  return <AppSwitcher current={CURRENT_APP} apps={APPS} />;
}

export type DeploymentSidebarProps = NavigationProps & {
  readonly theme: ThemeStore;
};

/** The workspace switcher and search, the views, the deployments and the theme row. */
export function DeploymentSidebar({
  theme,
  ...navigation
}: DeploymentSidebarProps): React.JSX.Element {
  return (
    <Sidebar
      label="Flags"
      navLabel={NAV_LABEL}
      top={
        <>
          <Switcher />
          <CommandPaletteButton store={paletteStore} label={PALETTE_LABEL} />
        </>
      }
      footer={<ThemeRow store={theme} />}
    >
      <NavigationGroups {...navigation} />
    </Sidebar>
  );
}

/**
 * The navigation below 900px, where the sidebar is hidden: the shared top bar
 * with search, and the same views and deployments in its drawer.
 */
export function FlagsTopBar({
  theme,
  ...navigation
}: DeploymentSidebarProps): React.JSX.Element {
  return (
    <TopBar
      switcher={<Switcher />}
      brand="Flags"
      navLabel={NAV_LABEL}
      theme={theme}
      actions={
        <button
          className="ui-topbar-btn"
          type="button"
          aria-label={PALETTE_LABEL}
          aria-keyshortcuts="Meta+K Control+K"
          onClick={() => {
            paletteStore.setOpen(true);
          }}
        >
          <SearchIcon aria-hidden="true" />
        </button>
      }
    >
      {(close) => <NavigationGroups {...navigation} onNavigate={close} />}
    </TopBar>
  );
}
