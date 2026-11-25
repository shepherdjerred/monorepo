import { useSyncExternalStore } from "react";

let drawerOpen = false;
const drawerListeners = new Set<() => void>();

function subscribeDrawer(listener: () => void): () => void {
  drawerListeners.add(listener);
  return () => {
    drawerListeners.delete(listener);
  };
}

function getDrawerSnapshot(): boolean {
  return drawerOpen;
}

export function setNavDrawerOpen(next: boolean): void {
  if (drawerOpen === next) {
    return;
  }
  drawerOpen = next;
  for (const listener of drawerListeners) {
    listener();
  }
}

export function useNavDrawerOpen(): boolean {
  return useSyncExternalStore(
    subscribeDrawer,
    getDrawerSnapshot,
    getDrawerSnapshot,
  );
}

if (typeof globalThis.matchMedia === "function") {
  const sidebarQuery = globalThis.matchMedia("(min-width: 901px)");
  sidebarQuery.addEventListener("change", (event) => {
    if (event.matches) {
      setNavDrawerOpen(false);
    }
  });
}

let activeSearchInput: HTMLInputElement | null = null;
let pendingSearchFocus = false;

export function registerSearchInput(node: HTMLInputElement | null): void {
  activeSearchInput = node;
  if (node !== null && pendingSearchFocus) {
    pendingSearchFocus = false;
    node.focus();
    node.select();
  }
}

export function focusSearchOrQueue(): boolean {
  if (activeSearchInput !== null) {
    activeSearchInput.focus();
    activeSearchInput.select();
    return true;
  }
  pendingSearchFocus = true;
  return false;
}

export function hasPendingSearchFocus(): boolean {
  return pendingSearchFocus;
}

export function clearPendingSearchFocus(): void {
  pendingSearchFocus = false;
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function asDomElement(target: EventTarget | null): Element | null {
  if (typeof Element === "undefined") {
    return null;
  }
  return target instanceof Element ? target : null;
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  const element = asDomElement(target);
  if (element === null) {
    return false;
  }
  const contentEditable =
    element instanceof HTMLElement && element.isContentEditable;
  return (
    EDITABLE_TAGS.has(element.tagName) ||
    contentEditable ||
    element.closest("[contenteditable='true']") !== null
  );
}

export function isSlashSearchShortcut(event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly isComposing?: boolean;
  readonly target: EventTarget | null;
}): boolean {
  if (
    event.key !== "/" ||
    event.isComposing === true ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return false;
  }
  const element = asDomElement(event.target);
  const insideOverlay =
    element !== null &&
    element.closest("[role='dialog'], [role='menu'], dialog") !== null;
  return !isEditableEventTarget(event.target) && !insideOverlay;
}
