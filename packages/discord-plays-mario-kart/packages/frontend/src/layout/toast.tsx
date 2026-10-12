import { useEffect } from "react";
import IconWarning from "~icons/ph/warning-circle-fill";
import IconX from "~icons/ph/x-bold";

const TOAST_MS = 4500;

/** A transient message pinned to the bottom of the screen. */
export function Toast({
  message,
  stamp,
  onDismiss,
}: {
  message: string;
  /** Changes for each new message, restarting the timer. */
  stamp: number;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [stamp, onDismiss]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role="alert"
        className="pointer-events-auto flex max-w-md animate-fade-in items-center gap-3 rounded-2xl border border-amber-400/25 bg-[#1b1710]/95 px-4 py-3 text-sm text-amber-100 shadow-card backdrop-blur"
      >
        <IconWarning className="size-5 shrink-0 text-amber-300" />
        <span>{message}</span>
        <button
          type="button"
          aria-label="Dismiss"
          className="ml-1 inline-flex size-6 items-center justify-center rounded-full text-amber-200/70 hover:bg-white/5 hover:text-amber-100"
          onClick={onDismiss}
        >
          <IconX className="size-3" />
        </button>
      </div>
    </div>
  );
}
