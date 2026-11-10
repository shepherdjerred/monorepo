import { useOutletContext } from "react-router";
import type { BootstrapData, Issue } from "#client/data/api.ts";
import type { View } from "./route.ts";

/** What the persistent layout shares with the routed page beneath it. */
export type ShellContext = {
  bootstrap: BootstrapData;
  teamKey: string;
  view: View;
  list: { items: Issue[]; loading: boolean; busy: boolean; error: unknown };
  /** The issue the keyboard selection rests on, if any. */
  current: string | undefined;
  setCurrent: (identifier: string) => void;
  openPeek: (identifier: string) => void;
  create: () => void;
};

export function useShell() {
  return useOutletContext<ShellContext>();
}
