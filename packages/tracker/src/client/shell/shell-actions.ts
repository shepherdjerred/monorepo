import type { NavigateFunction } from "react-router";
import type { Issue } from "#client/data/api.ts";
import { hasAppHistory, type RouteInfo } from "./route.ts";

export type Overlay = "create" | "palette" | "help" | "more";

type Shell = {
  route: RouteInfo;
  items: Issue[];
  peek: {
    identifier: string | undefined;
    open: (identifier: string) => void;
    close: () => void;
  };
  current: string | undefined;
  navigate: NavigateFunction;
  overlay: Overlay | undefined;
  setOverlay: (overlay: Overlay | undefined) => void;
};

function focusProperty(property: string) {
  const element = document.querySelector(`#${property}`);
  if (element instanceof HTMLSelectElement) {
    element.focus();
    element.showPicker();
  } else {
    element?.querySelector("input")?.focus();
  }
}

/** Move keyboard focus to the neighbouring issue row, keeping it in view. */
function focusRow(delta: number, current: string | undefined) {
  const rows = [
    ...document.querySelectorAll<HTMLAnchorElement>("a[data-issue-row]"),
  ];
  const index = rows.findIndex((row) => row.dataset["issueRow"] === current);
  const next =
    rows[
      index === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, index + delta))
    ];
  if (next === undefined) {
    return false;
  }
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest" });
  return true;
}

/**
 * Keyboard and palette commands. Each reports whether it acted, so a key
 * that does nothing here stays with the browser.
 */
export function shellActions(shell: Shell): Record<string, () => boolean> {
  const { route, items, peek, navigate } = shell;
  const openIssue = peek.identifier ?? route.identifier;
  const listFocused = route.isList && peek.identifier === undefined;
  const go = (to: string) => () => {
    void navigate(to);
    return true;
  };
  const show = (overlay: Overlay) => () => {
    shell.setOverlay(overlay);
    return true;
  };
  const onIssue = (run: () => void) => () => {
    if (openIssue === undefined) {
      return false;
    }
    run();
    return true;
  };
  const property = (name: string) =>
    onIssue(() => {
      focusProperty(`property-${name}`);
    });
  const adjacent = (delta: number) =>
    onIssue(() => {
      const index = items.findIndex((item) => item.identifier === openIssue);
      const next = items[index + delta];
      if (next === undefined) {
        return;
      }
      if (peek.identifier === undefined) {
        void navigate(`/issues/${next.identifier}`);
      } else {
        peek.open(next.identifier);
      }
    });
  return {
    palette: () => {
      shell.setOverlay(shell.overlay === "palette" ? undefined : "palette");
      return true;
    },
    c: show("create"),
    "?": show("help"),
    "/": () => {
      const search = document.querySelector<HTMLInputElement>("#issue-search");
      search?.focus();
      return search !== null;
    },
    j: () => listFocused && focusRow(1, shell.current),
    k: () => listFocused && focusRow(-1, shell.current),
    Enter: () => {
      const target = items.some(
        ({ identifier }) => identifier === shell.current,
      )
        ? shell.current
        : items[0]?.identifier;
      if (!listFocused || target === undefined) {
        return false;
      }
      peek.open(target);
      return true;
    },
    Escape: () => {
      // The peek dialog also closes itself; `close` ignores the second call.
      if (peek.identifier !== undefined) {
        peek.close();
        return true;
      }
      if (route.identifier === undefined) {
        return false;
      }
      void (hasAppHistory() ? navigate(-1) : navigate("/issues"));
      return true;
    },
    gi: go("/issues"),
    gb: go("/board"),
    gp: go("/projects"),
    ga: go("/activity"),
    gm: go("/issues?mine=true"),
    "[": adjacent(-1),
    "]": adjacent(1),
    s: property("state"),
    p: property("priority"),
    P: property("project"),
    a: property("assignee"),
    l: property("labels"),
    v: onIssue(() => {
      document.querySelector<HTMLButtonElement>("#issue-vote")?.click();
    }),
    e: onIssue(() => {
      document.querySelector<HTMLButtonElement>("#edit-description")?.click();
    }),
  };
}
