import { Menu } from "@base-ui/react/menu";
import { ChevronsUpDownIcon } from "lucide-react";

export type AppSwitcherEntry = {
  readonly label: string;
  readonly url: string;
  /** Entries sharing a group are listed together under its name, in first-seen order. */
  readonly group: string;
};

export type AppSwitcherProps = {
  /** The app on screen, shown on the workspace button. */
  readonly current: { readonly label: string; readonly mark: string };
  readonly apps: readonly AppSwitcherEntry[];
};

function groupEntries(
  apps: readonly AppSwitcherEntry[],
): [string, AppSwitcherEntry[]][] {
  const groups = new Map<string, AppSwitcherEntry[]>();
  for (const app of apps) {
    const entries = groups.get(app.group) ?? [];
    entries.push(app);
    groups.set(app.group, entries);
  }
  return [...groups.entries()];
}

/**
 * The workspace button at the top of the sidebar. It opens a menu of links to
 * the other consoles; every link navigates in the same tab.
 */
export function AppSwitcher({
  current,
  apps,
}: AppSwitcherProps): React.JSX.Element {
  return (
    <Menu.Root>
      <Menu.Trigger className="ui-workspace">
        <span className="ui-workspace-mark" aria-hidden="true">
          {current.mark}
        </span>
        <span className="ui-workspace-label">{current.label}</span>
        <span className="ui-sr-only">, switch app</span>
        <ChevronsUpDownIcon className="ui-workspace-icon" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="ui-menu-positioner" sideOffset={4}>
          <Menu.Popup className="ui-menu">
            {groupEntries(apps).map(([group, entries]) => (
              <Menu.Group key={group} className="ui-menu-group">
                <Menu.GroupLabel className="ui-menu-label">
                  {group}
                </Menu.GroupLabel>
                {entries.map((entry) => (
                  <Menu.LinkItem
                    key={entry.url}
                    href={entry.url}
                    className="ui-menu-item"
                    aria-current={
                      entry.label === current.label ? "page" : undefined
                    }
                  >
                    {entry.label}
                  </Menu.LinkItem>
                ))}
              </Menu.Group>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
