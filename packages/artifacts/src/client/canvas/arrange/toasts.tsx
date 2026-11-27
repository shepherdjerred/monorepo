import { useCallback, useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import type { CanvasFrameModel } from "#client/canvas/model.ts";

/** A toast leaves by itself after this long. */
export const TOAST_MS = 10_000;

export type Toast = { readonly id: string; readonly title: string };

/**
 * Frames that appear on the board without this actor placing them (an agent
 * published one): one toast each. The first set of frames is the baseline, and
 * frames this actor's own ops brought back (an undone delete) are not new.
 */
export function useNewFrameToasts(
  frames: readonly CanvasFrameModel[],
  takeOwn: () => ReadonlySet<string>,
): {
  readonly toasts: readonly Toast[];
  readonly dismiss: (id: string) => void;
} {
  const known = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  useEffect(() => {
    const ids = new Set(frames.map((frame) => frame.id));
    const before = known.current;
    known.current = ids;
    if (before === null) return;
    const own = takeOwn();
    const fresh = frames.filter(
      (frame) => !before.has(frame.id) && !own.has(frame.id),
    );
    if (fresh.length === 0) return;
    setToasts((current) => [
      ...current,
      ...fresh.map((frame) => ({ id: frame.id, title: frame.summary.title })),
    ]);
  }, [frames, takeOwn]);

  useEffect(() => {
    const [first] = toasts;
    if (first === undefined) return;
    const timer = setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== first.id));
    }, TOAST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toasts]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  return { toasts, dismiss };
}

export function Toasts({
  toasts,
  onJump,
  onDismiss,
}: {
  readonly toasts: readonly Toast[];
  readonly onJump: (id: string) => void;
  readonly onDismiss: (id: string) => void;
}): React.JSX.Element {
  return (
    <div
      className="ar-cv-toasts"
      role="status"
      aria-live="polite"
      data-cv-ignore=""
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="ar-cv-toast"
          data-testid="new-frame-toast"
        >
          <span>New frame: {toast.title}</span>
          <button
            type="button"
            className="ar-link-button"
            onClick={() => {
              onJump(toast.id);
              onDismiss(toast.id);
            }}
          >
            Jump to
          </button>
          <button
            type="button"
            className="ar-icon-button"
            aria-label="Dismiss"
            onClick={() => {
              onDismiss(toast.id);
            }}
          >
            <XIcon aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
