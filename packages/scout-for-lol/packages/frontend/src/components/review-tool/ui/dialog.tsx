import type { ReactNode } from "react";
import { cn } from "./cn.ts";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
};

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: DialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        className={cn(
          "w-full max-w-2xl rounded-lg bg-white shadow-xl",
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-surface-200 px-4 py-3">
          {title && (
            <h3 className="text-sm font-semibold text-surface-900">{title}</h3>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-surface-500 hover:text-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  );
}
