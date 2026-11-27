import { noop } from "#client/lib/noop.ts";
import { createContext, useContext } from "react";

/** What a page may ask of the shell it sits in. */
export type ShellActions = { readonly openShortcuts: () => void };

export const ShellContext = createContext<ShellActions>({
  openShortcuts: noop,
});

export function useShell(): ShellActions {
  return useContext(ShellContext);
}
