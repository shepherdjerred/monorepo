import type { ReactNode } from "react";
import {
  PhoneNav,
  ThemeButton,
} from "@shepherdjerred/console-ui/components/shell/phone-nav.tsx";
import type { ThemeStore } from "@shepherdjerred/console-ui/theme.ts";

/**
 * The top bar's theme switch.
 *
 * @deprecated `ConsoleShell` draws the phone top bar, theme switch included.
 */
export function ThemeToggle({
  store,
}: {
  readonly store: ThemeStore;
}): React.JSX.Element {
  return <ThemeButton store={store} />;
}

export type TopBarProps = {
  /** Usually the `AppSwitcher`. */
  readonly switcher: ReactNode;
  /** The app's name at the top of the drawer. */
  readonly brand: string;
  /** Accessible name of the drawer's navigation landmark. */
  readonly navLabel: string;
  /** Icon buttons between the switcher and the theme toggle, e.g. search. */
  readonly actions?: ReactNode;
  readonly theme: ThemeStore;
  /** The drawer's navigation groups; call `close` when a link is followed. */
  readonly children: (close: () => void) => ReactNode;
};

/**
 * The phone top bar and navigation drawer.
 *
 * @deprecated Use `ConsoleShell`, which declares the navigation once for the
 * sidebar and the drawer and adds the skip link, switcher and theme row.
 */
export function TopBar(props: TopBarProps): React.JSX.Element {
  return <PhoneNav {...props} />;
}
