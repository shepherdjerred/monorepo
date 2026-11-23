import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { readSession, sessionBoundary } from "./api.ts";
import { Login } from "./login.tsx";
import { ErrorNotice, Loading } from "./components.tsx";
import { Shell } from "./shell/shell.tsx";
import { classNames } from "./ui/class-names.ts";
import styles from "./app.module.css";

const cx = classNames(styles);

/**
 * The session gate, and the element of the root route: the sign-in page
 * until a session is known, then the shell around the matched page. The
 * shell is keyed by session generation, so a changed principal never
 * inherits the previous one's mounted pages.
 */
export function App() {
  const session = useQuery({
    queryKey: ["me"],
    queryFn: readSession,
  });
  const current = useSyncExternalStore(
    sessionBoundary.subscribe,
    sessionBoundary.getSnapshot,
    sessionBoundary.getSnapshot,
  );
  if (current.user === null) return <Login key={current.generation} />;
  if (session.error !== null)
    return (
      <main className={cx("sessionState")}>
        <ErrorNotice error={session.error} />
        <button
          className="button"
          onClick={() => {
            void session.refetch();
          }}
        >
          Try again
        </button>
      </main>
    );
  if (current.user === undefined)
    return (
      <main className={cx("sessionState")}>
        <Loading />
      </main>
    );
  return <Shell key={current.generation} user={current.user} />;
}
