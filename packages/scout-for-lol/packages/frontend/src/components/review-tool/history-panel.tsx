/**
 * Panel showing history of generated reviews
 */
import { useState, useSyncExternalStore } from "react";
import type { HistoryEntry } from "@scout-for-lol/frontend/lib/review-tool/history-manager";
import {
  loadHistory,
  deleteHistoryEntry,
  clearHistory,
} from "@scout-for-lol/frontend/lib/review-tool/history-manager";
import { StarRating } from "./star-rating.tsx";
import {
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  format,
} from "date-fns";

type HistoryPanelProps = {
  onSelectEntry: (entry: HistoryEntry) => void;
  selectedEntryId?: string | undefined;
  onCancelPending?: ((id: string) => void) | undefined;
  refreshTrigger?: number | undefined;
};

// Store for history data
let historyData: HistoryEntry[] = [];
const historyListeners = new Set<() => void>();

function subscribeToHistory(callback: () => void) {
  historyListeners.add(callback);
  // Also listen for history-update events
  const handleHistoryUpdate = () => {
    void loadHistoryData();
  };
  globalThis.addEventListener("history-update", handleHistoryUpdate);
  return () => {
    historyListeners.delete(callback);
    globalThis.removeEventListener("history-update", handleHistoryUpdate);
  };
}

function getHistorySnapshot() {
  return historyData;
}

// Load history data at module level
let historyLoadPromise: Promise<void> | null = null;

function loadHistoryData() {
  historyLoadPromise = (async () => {
    historyData = await loadHistory();
    historyListeners.forEach((listener) => {
      listener();
    });
  })();
  return historyLoadPromise;
}

// Start loading immediately
void loadHistoryData();

export function HistoryPanel({
  onSelectEntry,
  selectedEntryId,
  onCancelPending,
  refreshTrigger: _refreshTrigger,
}: HistoryPanelProps) {
  // Subscribe to history data store
  const history = useSyncExternalStore(
    subscribeToHistory,
    getHistorySnapshot,
    getHistorySnapshot,
  );
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const refreshHistory = async () => {
    console.log("[History] Refreshing history");
    await loadHistoryData();
    console.log("[History] Loaded entries:", historyData.length, historyData);
  };

  const handleDelete = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    await deleteHistoryEntry(id);
    await refreshHistory();
  };

  const handleCancelPending = (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (onCancelPending) {
      onCancelPending(id);
    }
    // Small delay to let the update complete before refreshing
    setTimeout(() => void refreshHistory(), 100);
  };

  const handleClearAll = async () => {
    await clearHistory();
    await refreshHistory();
    setShowConfirmClear(false);
  };

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const minutes = differenceInMinutes(now, date);
    const hours = differenceInHours(now, date);
    const days = differenceInDays(now, date);

    if (minutes < 1) {
      return "Just now";
    }
    if (minutes < 60) {
      return `${minutes.toString()}m ago`;
    }
    if (hours < 24) {
      return `${hours.toString()}h ago`;
    }
    if (days < 7) {
      return `${days.toString()}d ago`;
    }

    return format(date, "MMM d, yyyy");
  };

  return (
    <div className="bg-white rounded-lg border border-surface-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-surface-900">
          History ({history.length})
        </h3>
        {history.length > 0 && (
          <button
            onClick={() => {
              setShowConfirmClear(true);
            }}
            className="text-sm text-defeat-600 hover:text-defeat-700 font-medium"
          >
            Clear All
          </button>
        )}
      </div>

      {showConfirmClear && (
        <div className="mb-4 p-3 bg-defeat-50 border border-defeat-200 rounded">
          <div className="text-sm text-defeat-900 mb-2">
            Are you sure you want to clear all history?
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                void handleClearAll();
              }}
              className="px-3 py-1 bg-defeat-600 text-white text-sm rounded hover:bg-defeat-700"
            >
              Yes, clear all
            </button>
            <button
              onClick={() => {
                setShowConfirmClear(false);
              }}
              className="px-3 py-1 bg-surface-200 text-surface-700 text-sm rounded hover:bg-surface-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <div className="text-center py-8 text-surface-500">
          <div className="text-4xl mb-2">📝</div>
          <div className="text-sm">No history yet</div>
          <div className="text-xs mt-1">Generated reviews will appear here</div>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {history.map((entry) => {
            const isSelected = entry.id === selectedEntryId;
            const isPending = entry.status === "pending";
            const hasError = entry.status === "error";

            return (
              <div
                key={entry.id}
                onClick={() => {
                  onSelectEntry(entry);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectEntry(entry);
                  }
                }}
                role="button"
                tabIndex={0}
                className={`w-full text-left p-3 rounded border transition-colors cursor-pointer ${
                  isSelected
                    ? "border-brand-500 bg-brand-50"
                    : isPending
                      ? "border-victory-200 bg-victory-50 hover:bg-victory-100"
                      : hasError
                        ? "border-defeat-200 bg-defeat-50 hover:bg-defeat-100"
                        : "border-surface-200 hover:bg-surface-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {isPending ? (
                        <div className="flex items-center gap-1">
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-victory-600" />
                          <span className="text-victory-600 text-xs font-semibold">
                            GENERATING...
                          </span>
                        </div>
                      ) : (hasError ? (
                        <span className="text-defeat-600 text-xs font-semibold">
                          ERROR
                        </span>
                      ) : (
                        <span className="text-brand-600 text-xs font-semibold">
                          SUCCESS
                        </span>
                      ))}
                      <span className="text-xs text-surface-500">
                        {formatTimestamp(entry.timestamp)}
                      </span>
                    </div>
                    <div className="text-xs text-surface-700 space-y-0.5">
                      {entry.configSnapshot.personality && (
                        <div className="truncate">
                          🎭 {entry.configSnapshot.personality}
                        </div>
                      )}
                      {!isPending && !hasError && (
                        <div className="flex items-center gap-2 text-surface-500">
                          <span>{entry.result.text.length} chars</span>
                          {entry.result.image && <span>🖼️</span>}
                        </div>
                      )}
                      {entry.rating && (
                        <div className="mt-1">
                          <StarRating
                            rating={entry.rating}
                            readonly
                            size="small"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {isPending && (
                      <button
                        onClick={(e) => {
                          handleCancelPending(entry.id, e);
                        }}
                        className="shrink-0 text-surface-400 hover:text-victory-600 transition-colors"
                        title="Cancel (mark as interrupted)"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        void handleDelete(entry.id, e);
                      }}
                      className="shrink-0 text-surface-400 hover:text-defeat-600 transition-colors"
                      title="Delete"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
