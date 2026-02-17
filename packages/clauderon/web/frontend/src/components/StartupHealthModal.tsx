import { Button } from "@/components/ui/button";
import { X, AlertCircle } from "lucide-react";
import { useEffect } from "react";
import type { SessionHealthReport, ResourceState } from "@clauderon/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StartupHealthModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unhealthySessions: SessionHealthReport[];
  onViewSessions: () => void;
};

function getHealthLabel(state: ResourceState): string {
  switch (state.type) {
    case "Healthy":
      return "Healthy";
    case "Stopped":
      return "Stopped";
    case "Hibernated":
      return "Hibernated";
    case "Pending":
      return "Pending";
    case "Missing":
      return "Missing";
    case "Error":
      return "Error";
    case "CrashLoop":
      return "Crash Loop";
    case "DeletedExternally":
      return "Deleted Externally";
    case "DataLost":
      return "Data Lost";
    case "WorktreeMissing":
      return "Worktree Missing";
  }
}

function getHealthColor(state: ResourceState): string {
  switch (state.type) {
    case "Stopped":
    case "Hibernated":
    case "Pending":
      return "bg-yellow-500/20 text-yellow-700 border-yellow-500/50";
    case "Missing":
      return "bg-orange-500/20 text-orange-700 border-orange-500/50";
    case "Error":
    case "CrashLoop":
    case "DeletedExternally":
    case "DataLost":
    case "WorktreeMissing":
      return "bg-red-500/20 text-red-700 border-red-500/50";
    case "Healthy":
      return "bg-gray-500/20 text-gray-700 border-gray-500/50";
  }
}

export function StartupHealthModal({
  open,
  onOpenChange,
  unhealthySessions,
  onViewSessions,
}: StartupHealthModalProps) {
  // Handle ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    };

    if (open) {
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("keydown", handleEscape);
      };
    }
    return;
  }, [open, onOpenChange]);

  if (!open || unhealthySessions.length === 0) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: "hsl(220, 90%, 8%)",
          opacity: 0.85,
        }}
        onPointerDown={() => {
          onOpenChange(false);
        }}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-8 z-50">
        <div
          className="max-w-lg w-full flex flex-col border-4 border-primary"
          style={{
            backgroundColor: "hsl(220, 15%, 95%)",
            boxShadow:
              "12px 12px 0 hsl(220, 85%, 25%), 24px 24px 0 hsl(220, 90%, 10%)",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between p-4 border-b-4 border-primary"
            style={{ backgroundColor: "hsl(30, 85%, 50%)" }}
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-white" />
              <h2 className="text-xl font-bold font-mono uppercase tracking-wider text-white">
                Sessions Need Attention
              </h2>
            </div>
            <button
              onClick={() => {
                onOpenChange(false);
              }}
              className="cursor-pointer p-2 border-2 border-white bg-white/10 hover:bg-red-600 hover:text-white transition-all duration-200 font-bold text-white"
              title="Close dialog"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div
            className="p-6 space-y-4"
            style={{ backgroundColor: "hsl(220, 15%, 95%)" }}
          >
            <p className="text-sm text-foreground">
              Some sessions have missing or unhealthy backend resources:
            </p>

            {/* Session List */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {unhealthySessions.map((report) => (
                <div
                  key={report.session_id}
                  className="flex items-center justify-between p-3 border-2 border-primary/20 bg-white"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-semibold text-sm truncate">
                      {report.session_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {report.backend_type} - {report.description}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "ml-2 shrink-0 border font-mono text-xs",
                      getHealthColor(report.state),
                    )}
                  >
                    {getHealthLabel(report.state)}
                  </Badge>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              You can recreate these sessions to continue working.
            </p>

            {/* Footer */}
            <div className="flex gap-3 pt-4 border-t-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                Dismiss
              </Button>
              <Button
                variant="brutalist"
                onClick={() => {
                  onOpenChange(false);
                  onViewSessions();
                }}
              >
                View Sessions
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
