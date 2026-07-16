/**
 * Shared shell for review-tool modals: a click/keyboard-dismissable backdrop, a
 * centered dialog container with a sticky header (title + subtitle + close "X"),
 * the caller's content, and a sticky footer slot. Each modal supplies its own
 * body and footer buttons.
 */
import type { ReactNode } from "react";

type ReviewToolModalProps = {
  title: string;
  subtitle: string;
  onClose: () => void;
  /** Tailwind max-width class for the dialog container (e.g. "max-w-2xl"). */
  maxWidthClassName: string;
  children: ReactNode;
  footer: ReactNode;
};

export function ReviewToolModal({
  title,
  subtitle,
  onClose,
  maxWidthClassName,
  children,
  footer,
}: ReviewToolModalProps) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        role="button"
        tabIndex={0}
        className="fixed inset-0 bg-black/30 backdrop-blur-sm transition-all"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClose();
          }
        }}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className={`relative bg-white rounded-lg shadow-xl w-full max-h-[90vh] overflow-y-auto ${maxWidthClassName}`}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-surface-200 px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-surface-900">{title}</h2>
              <p className="text-sm text-surface-500 mt-1">{subtitle}</p>
            </div>
            <button
              onClick={onClose}
              className="text-surface-400 hover:text-surface-600 transition-colors"
              title="Close"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {children}

          {footer}
        </div>
      </div>
    </div>
  );
}
