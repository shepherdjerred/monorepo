import { useMutation } from "@tanstack/react-query";
import { Outlet, ScrollRestoration } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { logout } from "#client/api.ts";
import { ErrorNotice } from "#client/components.tsx";
import { useRouteFocus } from "./route-focus.ts";
import { Sidebar } from "./sidebar.tsx";
import { TabBar } from "./tab-bar.tsx";
import { TopBar } from "./top-bar.tsx";
import { ShellUserContext } from "./user.ts";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./shell.module.css";

const cx = classNames(styles);

/**
 * The signed-in frame: navigation at the side (or along the bottom on a
 * phone), search and the account at the top, and the current page between
 * them.
 */
export function Shell({ user }: { user: MediaUser }) {
  const signOut = useMutation({ mutationFn: logout });
  const main = useRouteFocus();
  return (
    <ShellUserContext value={user}>
      <div className={cx("shell")}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Sidebar user={user} />
        <div className={cx("column")}>
          <TopBar
            user={user}
            signingOut={signOut.isPending}
            onSignOut={() => {
              signOut.mutate();
            }}
          />
          <main id="main" className={cx("main")} ref={main} tabIndex={-1}>
            {user.restricted && (
              <div className="notice">
                New requests are paused for your account. You can still view
                your library and manage existing requests.
              </div>
            )}
            {signOut.error !== null && <ErrorNotice error={signOut.error} />}
            <Outlet />
          </main>
        </div>
        <TabBar user={user} />
      </div>
      <ScrollRestoration />
    </ShellUserContext>
  );
}
