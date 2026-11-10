import { useOutletContext } from "react-router";
import type { BootstrapData } from "#client/data/api.ts";
import type { IssuePages } from "#client/issues/issue-list-query.ts";
import type { IssuePrefill } from "#client/issues/issue-form.tsx";
import type { View } from "./route.ts";

/** What the persistent layout shares with the routed page beneath it. */
export type ShellContext = {
  bootstrap: BootstrapData;
  teamKey: string;
  view: View;
  /** The issues of the view, as far as they have been paged in. */
  list: IssuePages;
  /** The issue the keyboard selection rests on, if any. */
  current: string | undefined;
  setCurrent: (identifier: string) => void;
  openPeek: (identifier: string) => void;
  /** Open the New issue dialog, optionally with fields filled in. */
  create: (prefill?: IssuePrefill) => void;
  /** The list the bulk selection belongs to. */
  selectionScope: string;
};

export function useShell() {
  return useOutletContext<ShellContext>();
}
