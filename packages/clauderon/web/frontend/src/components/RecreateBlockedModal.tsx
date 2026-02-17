import { Button } from "@/components/ui/button";
import { X, AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import type { Session, SessionHealthReport } from "@clauderon/client";
import { Badge } from "@/components/ui/badge";

type RecreateBlockedModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  healthReport: SessionHealthReport;
};

export function RecreateBlockedModal({
  open,
  onOpenChange,
  session,
  healthReport,
}: RecreateBlockedModalProps) {
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

  if (!open) {
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
        onClick={() => {
          onOpenChange(false);
        }}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-8 z-50">
        <div
          className="max-w-lg w-full flex flex-col border-4 border-red-500"
          style={{
            backgroundColor: "hsl(220, 15%, 95%)",
            boxShadow:
              "12px 12px 0 hsl(0, 70%, 35%), 24px 24px 0 hsl(0, 80%, 20%)",
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between p-4 border-b-4 border-red-500"
            style={{ backgroundColor: "hsl(0, 70%, 45%)" }}
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-white" />
              <h2 className="text-xl font-bold font-mono uppercase tracking-wider text-white">
                Cannot Recreate
              </h2>
            </div>
            <button
              onClick={() => {
                onOpenChange(false);
              }}
              className="cursor-pointer p-2 border-2 border-white bg-white/10 hover:bg-red-800 hover:text-white transition-all duration-200 font-bold text-white"
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
            {/* Session Info */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">Session:</span>
                <span className="font-mono text-sm">
                  {session.title ?? session.name}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">Backend:</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {session.backend}
                </Badge>
              </div>
            </div>

            {/* Warning Message */}
            <div className="p-4 bg-red-500/10 border-2 border-red-500/50 space-y-2">
              <p className="text-sm font-semibold text-red-700">
                This session cannot be recreated.
              </p>
              <p className="text-sm text-red-600">
                Uncommitted work and Claude conversation history would be
                permanently lost.
              </p>
            </div>

            {/* Description */}
            {healthReport.description && (
              <p className="text-sm text-muted-foreground border-l-4 border-muted pl-3">
                {healthReport.description}
              </p>
            )}

            {/* Suggestions */}
            <div className="space-y-2">
              <p className="text-sm font-semibold">To continue working:</p>
              <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1 pl-2">
                <li>Push your changes to git</li>
                <li>Create a new session</li>
              </ol>
            </div>

            {/* Footer */}
            <div className="flex gap-3 pt-4 border-t-2 justify-end">
              <Button
                variant="brutalist"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                OK
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
