/**
 * Config action buttons (export, import, reset)
 */
type ConfigActionsProps = {
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
};

export function ConfigActions({
  onExport,
  onImport,
  onReset,
}: ConfigActionsProps) {
  return (
    <div className="p-6 mt-8 border-t border-scout-border">
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={onExport}
          className="px-5 py-2.5 bg-scout-success text-scout-success-ink rounded-lg hover:bg-scout-success transition-colors flex items-center gap-2"
          title="Export settings, custom personalities, and art styles"
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
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Export Config
        </button>
        <button
          onClick={onImport}
          className="px-5 py-2.5 bg-scout-accent text-scout-accent-ink rounded-lg hover:bg-scout-accent transition-colors flex items-center gap-2"
          title="Import config from JSON"
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
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
          Import Config
        </button>
        <button
          onClick={onReset}
          className="px-5 py-2.5 bg-scout-danger text-scout-danger-ink rounded-lg hover:bg-scout-danger transition-colors flex items-center gap-2"
          title="Reset settings to defaults"
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
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
