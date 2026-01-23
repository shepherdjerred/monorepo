import { Button } from "@/components/ui/button";
import { X, ChevronDown, ChevronRight, RefreshCw, Play, AlertTriangle, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import type { Session, SessionHealthReport, ResourceState } from "@clauderon/client";
import { AvailableAction } from "@clauderon/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type RecreateConfirmModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  healthReport: SessionHealthReport;
  onStart: () => void;
  onWake: () => void;
  onRecreate: () => void;
  onRecreateFresh: () => void;
  onUpdateImage: () => void;
  onCleanup: () => void;
  isLoading?: boolean;
}

function getStateDisplay(state: ResourceState): { label: string; color: string } {
  switch (state.type) {
    case "Healthy":
      return { label: "OK", color: "text-green-600" };
    case "Stopped":
      return { label: "Stopped", color: "text-yellow-600" };
    case "Hibernated":
      return { label: "Hibernated", color: "text-blue-600" };
    case "Pending":
      return { label: "Pending", color: "text-yellow-600" };
    case "Missing":
      return { label: "Missing", color: "text-orange-600" };
    case "Error":
      return { label: "Error", color: "text-red-600" };
    case "CrashLoop":
      return { label: "Crash Loop", color: "text-red-600" };
    case "DeletedExternally":
      return { label: "Deleted Externally", color: "text-red-600" };
    case "DataLost":
      return { label: "Data Lost", color: "text-red-600" };
    case "WorktreeMissing":
      return { label: "Worktree Missing", color: "text-red-600" };
    default:
      return { label: "Unknown", color: "text-gray-600" };
  }
}

function ActionButton({
  action,
  onClick,
  isLoading,
  isPrimary,
}: {
  action: AvailableAction;
  onClick: () => void;
  isLoading?: boolean | undefined;
  isPrimary?: boolean | undefined;
}) {
  const getActionDetails = (a: AvailableAction): { label: string; icon: React.ReactNode; variant: "default" | "destructive" | "outline" | "brutalist" } => {
    switch (a) {
      case AvailableAction.Start:
        return { label: "Start", icon: <Play className="w-4 h-4 mr-2" />, variant: "brutalist" };
      case AvailableAction.Wake:
        return { label: "Wake", icon: <Play className="w-4 h-4 mr-2" />, variant: "brutalist" };
      case AvailableAction.Recreate:
        return { label: "Recreate", icon: <RefreshCw className="w-4 h-4 mr-2" />, variant: "brutalist" };
      case AvailableAction.RecreateFresh:
        return { label: "Recreate Fresh", icon: <AlertTriangle className="w-4 h-4 mr-2" />, variant: "destructive" };
      case AvailableAction.UpdateImage:
        return { label: "Update Image", icon: <RefreshCw className="w-4 h-4 mr-2" />, variant: "brutalist" };
      case AvailableAction.Cleanup:
        return { label: "Clean Up", icon: <Trash2 className="w-4 h-4 mr-2" />, variant: "destructive" };
      default:
        return { label: a, icon: null, variant: "outline" };
    }
  };

  const details = getActionDetails(action);

  return (
    <Button
      variant={isPrimary ? details.variant : "outline"}
      onClick={onClick}
      disabled={isLoading}
      className={cn("cursor-pointer", isPrimary && "min-w-[120px]")}
    >
      {details.icon}
      {details.label}
    </Button>
  );
}

export function RecreateConfirmModal({
  open,
  onOpenChange,
  session,
  healthReport,
  onStart,
  onWake,
  onRecreate,
  onRecreateFresh,
  onUpdateImage,
  onCleanup,
  isLoading,
}: RecreateConfirmModalProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  // Handle ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    if (open) {
      document.addEventListener('keydown', handleEscape);
      return () => { document.removeEventListener('keydown', handleEscape); };
    }
    return undefined;
  }, [open, onOpenChange]);

  if (!open) return null;

  const stateDisplay = getStateDisplay(healthReport.state);
  const actions = healthReport.available_actions;

  const handleAction = (action: AvailableAction) => {
    switch (action) {
      case AvailableAction.Start:
        onStart();
        break;
      case AvailableAction.Wake:
        onWake();
        break;
      case AvailableAction.Recreate:
        onRecreate();
        break;
      case AvailableAction.RecreateFresh:
        onRecreateFresh();
        break;
      case AvailableAction.UpdateImage:
        onUpdateImage();
        break;
      case AvailableAction.Cleanup:
        onCleanup();
        break;
    }
    onOpenChange(false);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: 'hsl(220, 90%, 8%)',
          opacity: 0.85
        }}
        onClick={() => { onOpenChange(false); }}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-8 z-50">
        <div
          className="max-w-lg w-full flex flex-col border-4 border-primary"
          style={{
            backgroundColor: 'hsl(220, 15%, 95%)',
            boxShadow: '12px 12px 0 hsl(220, 85%, 25%), 24px 24px 0 hsl(220, 90%, 10%)'
          }}
          onClick={(e) => { e.stopPropagation(); }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between p-4 border-b-4 border-primary"
            style={{ backgroundColor: 'hsl(220, 85%, 25%)' }}
          >
            <h2 className="text-xl font-bold font-mono uppercase tracking-wider text-white">
              Session Actions
            </h2>
            <button
              onClick={() => { onOpenChange(false); }}
              className="cursor-pointer p-2 border-2 border-white bg-white/10 hover:bg-red-600 hover:text-white transition-all duration-200 font-bold text-white"
              title="Close dialog"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4" style={{ backgroundColor: 'hsl(220, 15%, 95%)' }}>
            {/* Session Info */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">Session:</span>
                <span className="font-mono text-sm">{session.title ?? session.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">Backend:</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {session.backend}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">Status:</span>
                <span className={cn("font-mono text-sm font-semibold", stateDisplay.color)}>
                  {stateDisplay.label}
                </span>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-foreground border-l-4 border-primary/30 pl-3">
              {healthReport.description}
            </p>

            {/* Data Safety Notice */}
            {healthReport.data_safe ? (
              <div className="flex items-center gap-2 p-2 bg-green-500/10 border-l-4 border-green-500 text-sm">
                <span className="text-green-700">Your code is safe.</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-2 bg-red-500/10 border-l-4 border-red-500 text-sm">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span className="text-red-700 font-semibold">Warning: Data may be lost.</span>
              </div>
            )}

            {/* Expandable Details */}
            {healthReport.details && (
              <button
                onClick={() => { setDetailsExpanded(!detailsExpanded); }}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
              >
                {detailsExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <span>{detailsExpanded ? "Hide details" : "Show details"}</span>
              </button>
            )}

            {detailsExpanded && healthReport.details && (
              <div className="p-3 bg-muted/30 border-2 border-muted text-xs font-mono whitespace-pre-wrap">
                {healthReport.details}
              </div>
            )}

            {/* Actions Footer */}
            <div className="flex gap-3 pt-4 border-t-2 justify-end flex-wrap">
              <Button variant="outline" onClick={() => { onOpenChange(false); }}>
                Cancel
              </Button>
              {actions.map((action, idx) => (
                <ActionButton
                  key={action}
                  action={action}
                  onClick={() => { handleAction(action); }}
                  isLoading={isLoading}
                  isPrimary={idx === 0 || action === healthReport.recommended_action}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
