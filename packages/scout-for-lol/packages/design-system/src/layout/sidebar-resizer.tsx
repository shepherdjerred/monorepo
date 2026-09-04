import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "#src/lib/cn.ts";

export const DEFAULT_SIDEBAR_WIDTH_PX = 256;
export const MIN_SIDEBAR_WIDTH_PX = 200;
export const MAX_SIDEBAR_WIDTH_PX = 480;
const SIDEBAR_STORAGE_KEY = "scout:sidebar-width";

function getInitialSidebarWidth(): number {
  try {
    const stored = globalThis.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored !== null) {
      const parsed = Number.parseInt(stored, 10);
      if (
        !Number.isNaN(parsed) &&
        parsed >= MIN_SIDEBAR_WIDTH_PX &&
        parsed <= MAX_SIDEBAR_WIDTH_PX
      ) {
        return parsed;
      }
    }
  } catch {
    return DEFAULT_SIDEBAR_WIDTH_PX;
  }
  return DEFAULT_SIDEBAR_WIDTH_PX;
}

function persistSidebarWidth(width: number): void {
  try {
    globalThis.localStorage.setItem(SIDEBAR_STORAGE_KEY, width.toString());
  } catch {
    // Local storage unavailable or restricted
  }
}

export function useSidebarResize(layoutRef: RefObject<HTMLDivElement | null>) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(
    getInitialSidebarWidth,
  );
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(sidebarWidth);

  useEffect(() => {
    widthRef.current = sidebarWidth;
    layoutRef.current?.style.setProperty(
      "--scout-sidebar-width",
      `${sidebarWidth.toString()}px`,
    );
  }, [sidebarWidth, layoutRef]);

  const startResizing = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      setIsResizing(true);
      const startX = event.clientX;
      const startWidth = widthRef.current;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = Math.max(
          MIN_SIDEBAR_WIDTH_PX,
          Math.min(MAX_SIDEBAR_WIDTH_PX, startWidth + delta),
        );
        widthRef.current = nextWidth;
        setSidebarWidth(nextWidth);
        layoutRef.current?.style.setProperty(
          "--scout-sidebar-width",
          `${nextWidth.toString()}px`,
        );
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
        globalThis.removeEventListener("mousemove", onMouseMove);
        globalThis.removeEventListener("mouseup", onMouseUp);
        persistSidebarWidth(widthRef.current);
      };

      document.body.style.setProperty("cursor", "col-resize");
      document.body.style.setProperty("user-select", "none");
      globalThis.addEventListener("mousemove", onMouseMove);
      globalThis.addEventListener("mouseup", onMouseUp);
    },
    [layoutRef],
  );

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH_PX);
    widthRef.current = DEFAULT_SIDEBAR_WIDTH_PX;
    layoutRef.current?.style.setProperty(
      "--scout-sidebar-width",
      `${DEFAULT_SIDEBAR_WIDTH_PX.toString()}px`,
    );
    try {
      globalThis.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
    } catch {
      // Local storage unavailable or restricted
    }
  }, [layoutRef]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      switch (event.key) {
        case "ArrowLeft": {
          event.preventDefault();
          const next = Math.max(MIN_SIDEBAR_WIDTH_PX, sidebarWidth - 16);
          setSidebarWidth(next);
          persistSidebarWidth(next);
          break;
        }
        case "ArrowRight": {
          event.preventDefault();
          const next = Math.min(MAX_SIDEBAR_WIDTH_PX, sidebarWidth + 16);
          setSidebarWidth(next);
          persistSidebarWidth(next);
          break;
        }
        case "Home":
        case "Enter": {
          event.preventDefault();
          resetSidebarWidth();
          break;
        }
        default: {
          break;
        }
      }
    },
    [sidebarWidth, resetSidebarWidth],
  );

  return {
    sidebarWidth,
    isResizing,
    startResizing,
    resetSidebarWidth,
    handleKeyDown,
  };
}

export function SidebarResizer(props: {
  readonly sidebarWidth: number;
  readonly isResizing: boolean;
  readonly onMouseDown: (event: ReactMouseEvent) => void;
  readonly onDoubleClick: () => void;
  readonly onKeyDown: (event: ReactKeyboardEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label="Resize sidebar"
      className={cn(
        "scout-sidebar-resizer",
        props.isResizing && "scout-sidebar-resizer--active",
      )}
      onMouseDown={props.onMouseDown}
      onDoubleClick={props.onDoubleClick}
      onKeyDown={props.onKeyDown}
      title="Drag to resize sidebar (double-click to reset)"
    />
  );
}
