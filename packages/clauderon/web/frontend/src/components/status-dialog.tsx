import {
  X,
  XCircle,
  TrendingUp,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { LoadingBlock } from "./loading-block.tsx";
import { UsageProgressBar } from "./usage-progress-bar.tsx";

type StatusDialogProps = {
  onClose: () => void;
};

export function StatusDialog({ onClose }: StatusDialogProps) {
  const statusQuery = useQuery({
    queryKey: ["system-status"],
    queryFn: () => apiClient.getSystemStatus(),
  });

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: "hsl(220, 90%, 8%)",
          opacity: 0.85,
        }}
      />
      <div className="fixed inset-0 flex items-center justify-center p-8 z-50">
        <div
          className="max-w-4xl w-full max-h-[90vh] flex flex-col border-4 border-primary"
          style={{
            backgroundColor: "hsl(220, 15%, 95%)",
            boxShadow:
              "12px 12px 0 hsl(220, 85%, 25%), 24px 24px 0 hsl(220, 90%, 10%)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between p-6 border-b-4 border-primary"
            style={{ backgroundColor: "hsl(220, 85%, 25%)" }}
          >
            <h2 className="text-2xl font-bold font-mono uppercase tracking-wider text-white">
              System Status
            </h2>
            <button
              onClick={onClose}
              className="cursor-pointer p-2 border-2 border-white bg-white/10 hover:bg-red-600 hover:text-white transition-all duration-200 font-bold text-white"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-6 space-y-6">
            <LoadingBlock
              queries={[statusQuery]}
              renderSuccess={(status) => (
              <>
                {/* Claude Code Usage Section */}
                {status.claude_usage != null && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <TrendingUp className="w-5 h-5 text-primary" />
                      <h3 className="text-xl font-semibold">
                        Claude Code Usage
                      </h3>
                    </div>

                    {/* Error Display */}
                    {status.claude_usage.error != null && (
                      <div className="mb-4 p-4 border-4 border-red-500 bg-red-50 dark:bg-red-950 text-red-900 dark:text-red-100 font-mono rounded-md">
                        <div className="flex items-start gap-2">
                          <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 space-y-2">
                            <div>
                              <strong className="font-bold">
                                Usage Tracking Error:
                              </strong>{" "}
                              {status.claude_usage.error.message}
                            </div>
                            {status.claude_usage.error.details != null &&
                              status.claude_usage.error.details.length > 0 && (
                                <details className="text-sm opacity-80">
                                  <summary className="cursor-pointer">
                                    Technical details
                                  </summary>
                                  <pre className="mt-2 p-2 bg-black/10 dark:bg-white/10 rounded text-xs whitespace-pre-wrap">
                                    {status.claude_usage.error.details}
                                  </pre>
                                </details>
                              )}
                            {status.claude_usage.error.suggestion != null &&
                              status.claude_usage.error.suggestion.length >
                                0 && (
                                <div className="mt-3 p-3 bg-white/50 dark:bg-black/20 rounded border-2 border-red-300 dark:border-red-700">
                                  <strong>💡 How to fix:</strong>
                                  <div className="mt-1">
                                    {status.claude_usage.error.suggestion}
                                  </div>
                                </div>
                              )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Only show usage data if no error */}
                    {!status.claude_usage.error && (
                      <>
                        {/* Organization info */}
                        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
                          <div className="text-sm">
                            <span className="font-semibold">Organization:</span>{" "}
                            {status.claude_usage.organization_name ??
                              status.claude_usage.organization_id}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Last updated:{" "}
                            {new Date(
                              status.claude_usage.fetched_at,
                            ).toLocaleString()}
                          </div>
                        </div>

                        {/* Usage windows */}
                        <div className="space-y-4">
                          <UsageProgressBar
                            window={status.claude_usage.five_hour}
                            title="5-Hour Window"
                            subtitle="Session-based usage limit"
                          />

                          <UsageProgressBar
                            window={status.claude_usage.seven_day}
                            title="7-Day Window"
                            subtitle="Weekly usage limit"
                          />

                          {status.claude_usage.seven_day_sonnet != null && (
                            <UsageProgressBar
                              window={status.claude_usage.seven_day_sonnet}
                              title="7-Day Sonnet Window"
                              subtitle="Sonnet-specific weekly limit"
                            />
                          )}
                        </div>

                        {/* Info about usage limits */}
                        <div className="mt-4 p-3 bg-secondary/30 border border-secondary rounded-md text-sm text-muted-foreground">
                          <p>
                            Usage limits apply to Claude Code sessions. The
                            5-hour window resets based on when you first
                            interact, while the 7-day window is a rolling weekly
                            limit.
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
              )}
            />
          </div>

          {/* Footer Actions */}
          <div
            className="flex justify-end gap-3 p-6 border-t-4 border-primary"
            style={{ backgroundColor: "hsl(220, 15%, 90%)" }}
          >
            <button
              onClick={onClose}
              className="cursor-pointer px-4 py-2 border-2 font-bold transition-colors duration-200 hover:opacity-90"
              style={{
                backgroundColor: "hsl(220, 85%, 25%)",
                color: "white",
                borderColor: "hsl(220, 85%, 25%)",
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
