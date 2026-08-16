import { createContext, useContext, type ReactNode } from "react";

const ScoutPortalContainerContext = createContext<HTMLElement | undefined>(
  undefined,
);

export function ScoutPortalProvider(props: {
  children: ReactNode;
  container: HTMLElement;
}) {
  return (
    <ScoutPortalContainerContext.Provider value={props.container}>
      {props.children}
    </ScoutPortalContainerContext.Provider>
  );
}

export function useScoutPortalContainer(): HTMLElement | undefined {
  return useContext(ScoutPortalContainerContext);
}
