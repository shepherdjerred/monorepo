/**
 * Cost tracking display component
 */
import { useSyncExternalStore } from "react";
import type { CostTracker } from "@scout-for-lol/frontend/lib/review-tool/costs";
import { formatCost } from "@scout-for-lol/frontend/lib/review-tool/costs";

type CostDisplayProps = {
  costTracker: CostTracker;
};

export function CostDisplay({ costTracker }: CostDisplayProps) {
  // Subscribe directly to the cost tracker - no useEffect needed!
  const snapshot = useSyncExternalStore(
    (callback) => costTracker.subscribe(callback),
    () => costTracker.getSnapshot(),
    () => costTracker.getSnapshot(),
  );

  const { total, count } = snapshot;

  return (
    <div className="bg-white rounded-lg border border-surface-200 p-4">
      <h3 className="text-lg font-semibold text-surface-900 mb-4">Session Costs</h3>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-surface-600">Total Requests:</span>
          <span className="font-mono text-sm font-medium text-surface-900">{count}</span>
        </div>

        <div className="border-t border-surface-200 pt-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-surface-600">Text Input:</span>
            <span className="font-mono text-sm text-surface-900">{formatCost(total.textInputCost)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-surface-600">Text Output:</span>
            <span className="font-mono text-sm text-surface-900">{formatCost(total.textOutputCost)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-surface-600">Images:</span>
            <span className="font-mono text-sm text-surface-900">{formatCost(total.imageCost)}</span>
          </div>
        </div>

        <div className="border-t-2 border-surface-300 pt-3">
          <div className="flex justify-between items-center">
            <span className="text-base font-semibold text-surface-900">Total:</span>
            <span className="font-mono text-lg font-bold text-brand-600">{formatCost(total.totalCost)}</span>
          </div>
        </div>

        <div className="flex gap-2 pt-3">
          <button
            onClick={() => {
              void (async () => {
                const report = await costTracker.export();
                const blob = new Blob([report], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `cost-report-${new Date().toISOString()}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              })();
            }}
            className="flex-1 px-3 py-2 bg-black text-white rounded hover:bg-brand-700 transition-colors text-sm"
          >
            Export Report
          </button>
          <button
            onClick={() => {
              if (confirm("Clear cost history?")) {
                void costTracker.clear();
              }
            }}
            className="flex-1 px-3 py-2 bg-defeat-600 text-white bg-black rounded hover:bg-defeat-700 transition-colors text-sm"
          >
            Clear History
          </button>
        </div>
      </div>
    </div>
  );
}
