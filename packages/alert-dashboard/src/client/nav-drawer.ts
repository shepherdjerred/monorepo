import { useSyncExternalStore } from "react";

import { isPaletteShortcut } from "./platform/palette.tsx";

// Wider viewports show the sidebar instead of the drawer. `globals.css`
// switches the two at the same width.
const sidebarQuery = globalThis.matchMedia("(min-width: 901px)");

// Whether the phone navigation drawer is open lives outside React, like the
// palette's open state, so the listeners below can close it without an effect.
let drawerOpen = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setNavDrawerOpen(next: boolean): void {
  if (drawerOpen === next) return;
  drawerOpen = next;
  for (const listener of listeners) listener();
}

export function useNavDrawerOpen(): boolean {
  return useSyncExternalStore(subscribe, () => drawerOpen);
}

// The trigger disappears with the top bar, so a drawer left open while the
// window grows past phone width would have nothing to return focus to.
sidebarQuery.addEventListener("change", (event) => {
  if (event.matches) setNavDrawerOpen(false);
});

// The palette is a modal of its own; opening it replaces the drawer rather
// than stacking a second dialog on top of it.
document.addEventListener("keydown", (event) => {
  if (isPaletteShortcut(event)) setNavDrawerOpen(false);
});
