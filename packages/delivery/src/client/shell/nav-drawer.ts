import { useSyncExternalStore } from "react";

// Above 900px console-ui shows the persistent sidebar and hides `.topbar`.
let drawerOpen = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return drawerOpen;
}

export function setNavDrawerOpen(next: boolean): void {
  if (drawerOpen === next) return;
  drawerOpen = next;
  for (const listener of listeners) listener();
}

export function useNavDrawerOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

if (typeof globalThis.matchMedia === "function") {
  const sidebarQuery = globalThis.matchMedia("(min-width: 901px)");
  sidebarQuery.addEventListener("change", (event) => {
    if (event.matches) setNavDrawerOpen(false);
  });
}
