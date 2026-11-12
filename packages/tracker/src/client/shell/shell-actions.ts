import type { NavigateFunction } from "react-router";
import { undoStack } from "#client/data/undo.ts";
import type { IssuePages } from "#client/issues/issue-list-query.ts";
import type { IssuePrefill } from "#client/issues/issue-form.tsx";
import { openPicker } from "#client/controls/enum-picker.tsx";
import {
  assignToMe,
  copyIds,
  copyLinks,
  pickProperty,
} from "#client/controls/issue-actions.ts";
import {
  emptySelection,
  extendSelection,
  selectAll,
  selectedInOrder,
  selectionStore,
  toggleSelected,
} from "#client/controls/selection.ts";
import { focusIssueRow, visibleOrder } from "./list-navigation.ts";
import { hasAppHistory, type RouteInfo } from "./route.ts";

export type Overlay = "create" | "palette" | "help" | "more";

export type Shell = {
  route: RouteInfo;
  list: IssuePages;
  peek: {
    identifier: string | undefined;
    open: (identifier: string) => void;
    close: () => void;
  };
  current: string | undefined;
  navigate: NavigateFunction;
  overlay: Overlay | undefined;
  setOverlay: (overlay: Overlay | undefined) => void;
  selectionScope: string;
  create: (prefill?: IssuePrefill) => void;
  /** What a new issue created from this view starts with. */
  prefill: IssuePrefill;
};

type Property = "state" | "priority" | "assignee" | "labels" | "project";

/** What issue actions apply to, and where their controls are on screen. */
export type Targets = {
  identifiers: string[];
  where: "issue" | "selection" | "row";
};

const rowSelector = (name: string, identifier: string) =>
  `[data-picker="${name}"][data-issue="${CSS.escape(identifier)}"]`;
const rowLink = (identifier: string) =>
  document.querySelector<HTMLElement>(
    `a[data-issue-row="${CSS.escape(identifier)}"]`,
  );

function neighbour<T>(items: readonly T[], index: number, delta: number) {
  return items[
    index === -1 ? 0 : Math.max(0, Math.min(items.length - 1, index + delta))
  ];
}

/** The identifiers in the order the screen shows them. */
function screenOrder(shell: Shell): readonly string[] {
  if (shell.route.view === "board") {
    return [
      ...document.querySelectorAll<HTMLAnchorElement>("a[data-issue-row]"),
    ].flatMap((card) => {
      const identifier = card.dataset["issueRow"];
      return identifier === undefined ? [] : [identifier];
    });
  }
  return visibleOrder() ?? shell.list.items.map(({ identifier }) => identifier);
}

function focusIssue(shell: Shell, identifier: string) {
  if (shell.route.view === "board") {
    const card = rowLink(identifier);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
    return card !== null;
  }
  return focusIssueRow(identifier);
}

/**
 * Move keyboard focus to the neighbouring issue, keeping it in view. The
 * list follows its data, since most of its rows are not in the document;
 * the board follows the cards as they are laid out in columns.
 */
function focusRow(delta: number, shell: Shell) {
  const order = screenOrder(shell);
  const next = neighbour(order, order.indexOf(shell.current ?? ""), delta);
  return next !== undefined && focusIssue(shell, next);
}

/**
 * The issues an action applies to: the open issue, else the selection,
 * else the row the keyboard rests on.
 */
export function actionTargets(shell: Shell): Targets | undefined {
  const open = shell.peek.identifier ?? shell.route.identifier;
  if (open !== undefined) {
    return { identifiers: [open], where: "issue" };
  }
  if (!shell.route.isList) {
    return;
  }
  const order = screenOrder(shell);
  const selected = selectedInOrder(
    selectionStore.read(shell.selectionScope),
    order,
  );
  if (selected.length > 0) {
    return { identifiers: selected, where: "selection" };
  }
  return shell.current !== undefined && order.includes(shell.current)
    ? { identifiers: [shell.current], where: "row" }
    : undefined;
}

/** Open the picker for a property of whatever the action applies to. */
function openProperty(name: Property, shell: Shell) {
  const targets = actionTargets(shell);
  const [first] = targets?.identifiers ?? [];
  if (targets === undefined || first === undefined) {
    return false;
  }
  const selector =
    targets.where === "issue"
      ? `#property-${name}`
      : targets.where === "selection"
        ? `#bulk-${name}`
        : rowSelector(name, first);
  if (openPicker(document.querySelector(selector))) {
    return true;
  }
  // A property the row does not show opens from the row itself.
  const anchor = rowLink(first);
  if (anchor === null || name === "state" || name === "priority") {
    return false;
  }
  pickProperty(name, targets.identifiers, anchor);
  return true;
}

function selectionActions(shell: Shell) {
  const scope = shell.selectionScope;
  const listFocused = shell.route.isList && shell.peek.identifier === undefined;
  const extend = (delta: number) => () => {
    const order = screenOrder(shell);
    const { current } = shell;
    if (!listFocused || current === undefined || !order.includes(current)) {
      return false;
    }
    const next = neighbour(order, order.indexOf(current), delta);
    if (next === undefined) {
      return false;
    }
    selectionStore.update(scope, (selection) =>
      extendSelection(selection, order, current, next),
    );
    focusIssue(shell, next);
    return true;
  };
  return {
    x: () => {
      const { current } = shell;
      if (!listFocused || current === undefined) {
        return false;
      }
      selectionStore.update(scope, (selection) =>
        toggleSelected(selection, current),
      );
      return true;
    },
    J: extend(1),
    K: extend(-1),
    selectAll: () => {
      // Elsewhere ⌘ A keeps selecting the page's text.
      if (
        !listFocused ||
        document.activeElement?.closest(".issue-list, .board") == null
      ) {
        return false;
      }
      selectionStore.update(scope, () => selectAll(screenOrder(shell)));
      return true;
    },
    clear: () => {
      if (selectionStore.read(scope).ids.size === 0) {
        return false;
      }
      selectionStore.update(scope, () => emptySelection);
      return true;
    },
  };
}

/**
 * Keyboard and palette commands. Each reports whether it acted, so a key
 * that does nothing here stays with the browser.
 */
export function shellActions(shell: Shell): Record<string, () => boolean> {
  const { route, peek, navigate } = shell;
  const { items } = shell.list;
  const openIssue = peek.identifier ?? route.identifier;
  const listFocused = route.isList && peek.identifier === undefined;
  const selection = selectionActions(shell);
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
  const onTargets = (run: (identifiers: string[]) => void) => () => {
    const targets = actionTargets(shell);
    if (targets === undefined) {
      return false;
    }
    run(targets.identifiers);
    return true;
  };
  const property = (name: Property) => () => openProperty(name, shell);
  const adjacent = (delta: number) =>
    onIssue(() => {
      const index = items.findIndex((item) => item.identifier === openIssue);
      const next = items[index + delta];
      if (next === undefined) {
        // Past the last loaded issue: page the next ones in for another press.
        if (delta > 0 && shell.list.hasMore && !shell.list.loadingMore) {
          shell.list.loadMore();
        }
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
    c: () => {
      shell.create();
      return true;
    },
    C: () => {
      shell.create(shell.prefill);
      return true;
    },
    "?": show("help"),
    "/": () => {
      const search = document.querySelector<HTMLInputElement>("#issue-search");
      search?.focus();
      return search !== null;
    },
    f: () => openPicker(document.querySelector("#filter-button")),
    undo: () => undoStack.runNewest(),
    j: () => listFocused && focusRow(1, shell),
    k: () => listFocused && focusRow(-1, shell),
    ...selection,
    Enter: () => {
      const order = screenOrder(shell);
      const target =
        shell.current !== undefined && order.includes(shell.current)
          ? shell.current
          : order[0];
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
      if (selection.clear()) {
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
    i: onTargets(assignToMe),
    copyId: onTargets(copyIds),
    copyLink: onTargets(copyLinks),
    v: onIssue(() => {
      document.querySelector<HTMLButtonElement>("#issue-vote")?.click();
    }),
    e: onIssue(() => {
      document.querySelector<HTMLButtonElement>("#edit-description")?.click();
    }),
  };
}
