/**
 * Cost tracking display component
 */
import { useSyncExternalStore } from "react";
import type { CostTracker } from "#src/lib/review-tool/costs.ts";
import { formatCost } from "#src/lib/review-tool/costs.ts";

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
    <div className="bg-scout-surface rounded-lg border border-scout-border p-4">
      <h3 className="text-lg font-semibold text-scout-ink mb-4">
        Session Costs
      </h3>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-scout-subtle">Total Requests:</span>
          <span className="font-mono text-sm font-medium text-scout-ink">
            {count}
          </span>
        </div>

        <div className="border-t border-scout-border pt-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-scout-subtle">Text Input:</span>
            <span className="font-mono text-sm text-scout-ink">
              {formatCost(total.textInputCost)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-scout-subtle">Text Output:</span>
            <span className="font-mono text-sm text-scout-ink">
              {formatCost(total.textOutputCost)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-scout-subtle">Images:</span>
            <span className="font-mono text-sm text-scout-ink">
              {formatCost(total.imageCost)}
            </span>
          </div>
        </div>

        <div className="border-t-2 border-scout-border pt-3">
          <div className="flex justify-between items-center">
            <span className="text-base font-semibold text-scout-ink">
              Total:
            </span>
            <span className="font-mono text-lg font-bold text-scout-brand">
              {formatCost(total.totalCost)}
            </span>
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
            className="flex-1 px-3 py-2 bg-scout-brand text-scout-brand-ink rounded hover:bg-scout-brand transition-colors text-sm"
          >
            Export Report
          </button>
          <button
            onClick={() => {
              if (confirm("Clear cost history?")) {
                void costTracker.clear();
              }
            }}
            className="flex-1 px-3 py-2 bg-scout-danger text-scout-danger-ink rounded hover:bg-scout-danger transition-colors text-sm"
          >
            Clear History
          </button>
        </div>
      </div>
    </div>
  );
}
