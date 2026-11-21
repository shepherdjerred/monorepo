import { createContext, useContext } from "react";
import type { MediaUser } from "#shared/contract.ts";

/** The user the shell was rendered for; null outside a signed-in shell. */
export const ShellUserContext = createContext<MediaUser | null>(null);

/**
 * The signed-in user of the shell a page renders in. The shell is remounted
 * for every session generation, so a page never sees a retired principal.
 */
export function useUser(): MediaUser {
  const user = useContext(ShellUserContext);
  if (user === null) {
    throw new Error("A page rendered outside the signed-in shell");
  }
  return user;
}
