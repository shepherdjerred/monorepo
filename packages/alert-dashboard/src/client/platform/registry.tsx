import { createContext, useContext, type ReactNode } from "react";

import type { ModuleRegistry } from "./module.ts";

const RegistryContext = createContext<ModuleRegistry | undefined>(undefined);

/**
 * Hands the composed registry to pages. Pages read it from context rather
 * than importing the composition root, which itself imports every page.
 */
export function RegistryProvider({
  registry,
  children,
}: {
  readonly registry: ModuleRegistry;
  readonly children: ReactNode;
}): React.JSX.Element {
  return <RegistryContext value={registry}>{children}</RegistryContext>;
}

export function useRegistry(): ModuleRegistry {
  const registry = useContext(RegistryContext);
  if (registry === undefined)
    throw new Error("useRegistry needs a RegistryProvider above it");
  return registry;
}
