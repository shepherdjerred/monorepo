import { useCallback, useEffect, useState } from "react";

const KEY = "artifacts.panel.collapsed.v1";
/** At and below this width the panel is a bottom sheet, collapsed to start with. */
export const NARROW_QUERY = "(max-width: 900px)";

function read(viewer: string): boolean | null {
  try {
    const value = localStorage.getItem(`${KEY}:${viewer}`);
    return value === null ? null : value === "true";
  } catch {
    return null;
  }
}

function write(viewer: string, collapsed: boolean): void {
  try {
    localStorage.setItem(`${KEY}:${viewer}`, String(collapsed));
  } catch {
    // Blocked storage just forgets the choice.
  }
}

export type PanelState = {
  readonly collapsed: boolean;
  readonly toggle: () => void;
  readonly expand: () => void;
  readonly collapse: () => void;
};

/**
 * Whether the comments panel is collapsed, remembered per viewer ("board" or
 * "focused"). With nothing stored it starts open, except on a narrow screen
 * where it is a bottom sheet and starts collapsed.
 */
export function usePanelState(viewer: string): PanelState {
  const [collapsed, setCollapsed] = useState(
    () => read(viewer) ?? globalThis.matchMedia(NARROW_QUERY).matches,
  );
  const set = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      write(viewer, next);
    },
    [viewer],
  );
  return {
    collapsed,
    toggle: useCallback(() => {
      set(!collapsed);
    }, [set, collapsed]),
    expand: useCallback(() => {
      set(false);
    }, [set]),
    collapse: useCallback(() => {
      set(true);
    }, [set]),
  };
}

/** The width the open panel takes from the canvas on a wide screen, in pixels. */
export const PANEL_WIDTH = 360;
export const PANEL_INSET = 12;
/** What a wide screen keeps clear on the right while the panel is open. */
export const PANEL_CLEARANCE = PANEL_WIDTH + 2 * PANEL_INSET;

/**
 * Publishes the clearance as `--ar-inset-right` so the stylesheets can keep
 * pills and the viewer out from under the open panel; cleared on leaving.
 */
export function usePanelInset(inset: number): void {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ar-inset-right", `${String(inset)}px`);
    return () => {
      root.style.removeProperty("--ar-inset-right");
    };
  }, [inset]);
}
