/**
 * Alert and info box components for the results panel
 */

export function ValidationErrorAlert({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-4 p-4 rounded-xl bg-defeat-50 border border-defeat-200 animate-fade-in">
      <div className="flex items-start gap-3">
        <svg
          className="w-5 h-5 text-defeat-500 shrink-0 mt-0.5"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
        <div className="flex-1">
          <div className="font-semibold text-defeat-900 mb-1">
            Cannot Generate Review
          </div>
          <div className="text-sm text-defeat-700">{error}</div>
        </div>
        <button
          onClick={onDismiss}
          className="text-defeat-400 hover:text-defeat-600"
        >
          <svg
            className="w-4 h-4"
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
    </div>
  );
}

export function GenerationErrorAlert({ error }: { error: string }) {
  return (
    <div className="mb-4 p-4 rounded-xl bg-defeat-50 border border-defeat-200 animate-fade-in">
      <div className="flex items-start gap-3">
        <svg
          className="w-5 h-5 text-defeat-500 shrink-0 mt-0.5"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
        <div className="flex-1">
          <div className="font-semibold text-defeat-900 mb-1">
            Generation Failed
          </div>
          <div className="text-sm text-defeat-700">{error}</div>
        </div>
      </div>
    </div>
  );
}

export function NoMatchInfoBox() {
  return (
    <div className="mb-4 p-4 rounded-xl bg-victory-50 border border-victory-200 text-sm text-victory-800 flex items-center gap-3">
      <svg
        className="w-5 h-5 text-victory-500 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>
        No match selected. Select a match from the browser to generate a review.
      </span>
    </div>
  );
}
