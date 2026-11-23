import {
  AppSwitcher,
  Field,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  ThemeRow,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import {
  deploymentPath,
  sidebarEntries,
  type Route,
  type SidebarEntry,
} from "./model.ts";

const APPS = CONSOLE_LINKS.map(({ label, url, group }) => ({
  label,
  url,
  group,
}));

function hrefOf(id: string): string {
  const [catalog, stage] = id.split("/");
  return catalog === undefined || stage === undefined
    ? "/"
    : deploymentPath(catalog, stage);
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

export type DeploymentSidebarProps = {
  /** Deployment ids (`catalog/stage`) in the order the API lists them. */
  readonly ids: readonly string[] | undefined;
  readonly counts: ReadonlyMap<string, number>;
  readonly route: Route | undefined;
  readonly theme: ThemeStore;
  readonly status?: string | undefined;
  readonly failure?: string | undefined;
};

/** The workspace switcher, the deployment list and the theme row. */
export function DeploymentSidebar({
  ids,
  counts,
  route,
  theme,
  status,
  failure,
}: DeploymentSidebarProps): React.JSX.Element {
  const entries: SidebarEntry[] = ids === undefined ? [] : sidebarEntries(ids);
  const singles = entries.filter((entry) => entry.kind === "single");
  const groups = entries.filter((entry) => entry.kind === "group");
  return (
    <Sidebar
      top={<AppSwitcher current={{ label: "Flags", mark: "F" }} apps={APPS} />}
      navLabel="Deployments"
      footer={<ThemeRow store={theme} />}
    >
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
              {...countProps(counts, entry.id)}
              current={isCurrent(route, entry.id)}
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
              {...countProps(counts, stage.id)}
              current={isCurrent(route, stage.id)}
            />
          ))}
        </SidebarGroup>
      ))}
    </Sidebar>
  );
}

/**
 * The deployment list below 900px, where the sidebar is hidden. A native
 * select keeps the choice reachable without a drawer.
 */
export function DeploymentPicker({
  ids,
  route,
}: {
  readonly ids: readonly string[];
  readonly route: Route | undefined;
}): React.JSX.Element {
  const selected = ids.find((id) => isCurrent(route, id));
  return (
    <div className="ui-toolbar fl-picker">
      <AppSwitcher current={{ label: "Flags", mark: "F" }} apps={APPS} />
      <Field label="Deployment" layout="inline">
        {(control) => (
          <select
            {...control}
            value={selected ?? ""}
            onChange={(event) => {
              if (event.target.value.length > 0)
                globalThis.location.assign(hrefOf(event.target.value));
            }}
          >
            {selected === undefined ? <option value="">Choose…</option> : null}
            {ids.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}
