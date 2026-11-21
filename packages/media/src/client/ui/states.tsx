import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ApiError } from "#client/api.ts";
import { classNames } from "./class-names.ts";
import styles from "./states.module.css";

const cx = classNames(styles);

/**
 * A list with nothing in it: what is missing, and in `children` what to do
 * about it. `action` is the one control that does it, when there is one.
 */
export function EmptyState(props: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const { title, children, action } = props;
  return (
    <div className={cx("state")}>
      <props.icon className={cx("icon")} aria-hidden="true" />
      <h2 className={cx("title")}>{title}</h2>
      <p className={cx("body")}>{children}</p>
      {action !== undefined && <div className={cx("action")}>{action}</div>}
    </div>
  );
}

type Failure = { title: string; body: string };

/**
 * What went wrong, in the reader's terms, by the kind of failure:
 *
 * - no response at all (the browser's own `TypeError`, or a response that
 *   was not the API's);
 * - the server failing (5xx);
 * - Plex access Media could not confirm, which only Plex or the owner fixes;
 * - anything else the API refused, in the words the API chose.
 */
function describe(error: Error, what: string): Failure {
  if (!(error instanceof ApiError)) {
    return {
      title: `${what} did not load`,
      body: "Media could not be reached. Check your connection, then try again.",
    };
  }
  if (error.code === "plex_library_access_required") {
    return {
      title: "Media could not confirm your Plex access",
      body: "The library is shown to people who can open it in Plex. Open Plex to check you still can, then try again; if that does not help, ask the library owner.",
    };
  }
  if (error.status >= 500) {
    return {
      title: `${what} did not load`,
      body: "Media ran into a problem on its side. Try again in a moment.",
    };
  }
  return { title: `${what} did not load`, body: error.message };
}

/**
 * A read that failed, in place of the content it would have shown. `what`
 * names that content as the start of a sentence ("Your library").
 */
export function ErrorState({
  error,
  what,
  onRetry,
}: {
  error: Error;
  what: string;
  onRetry: () => void;
}) {
  const failure = describe(error, what);
  return (
    <div
      className={`${cx("state")} ${cx("failed")}`}
      role="alert"
      data-ui="error-state"
    >
      <h2 className={cx("title")}>{failure.title}</h2>
      <p className={cx("body")}>{failure.body}</p>
      <div className={cx("action")}>
        <button className="button" type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}
