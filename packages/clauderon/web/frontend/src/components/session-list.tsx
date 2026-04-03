import { useState, useMemo, useCallback } from "react";
import type { Session, SessionHealthReport } from "@clauderon/client";
import { SessionStatus, type MergeMethod } from "@clauderon/shared";
import { useQueryClient } from "@tanstack/react-query";
import { SessionCard } from "./session-card.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { StatusDialog } from "./status-dialog.tsx";
import { EditSessionDialog } from "./edit-session-dialog.tsx";
import { StartupHealthModal } from "./startup-health-modal.tsx";
import { RecreateBlockedModal } from "./recreate-blocked-modal.tsx";
import { RecreateModalWrapper } from "./recreate-modal-callbacks.tsx";
import { useSessions, useHealthReports } from "@/hooks/use-sessions";
import {
  useArchiveSession,
  useUnarchiveSession,
  useRefreshSession,
  useDeleteSession,
  useMergePr,
  useStartSession,
  useRecreateSession,
  useCleanupSession,
} from "@/hooks/use-session-mutations";
import { useSessionEvents } from "@/hooks/use-session-events.ts";
import { toast } from "sonner";
import { Plus, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type FilterStatus,
  toFilterStatus,
  getConfirmDialogTitle,
  getConfirmDialogDescription,
  getConfirmDialogLabel,
  TAB_TRIGGER_CLASS,
} from "./session-list-helpers.ts";

// Initialize filter from URL parameter
function getInitialFilter(): FilterStatus {
  const params = new URLSearchParams(globalThis.location.search);
  const tabParam = params.get("tab");
  if (tabParam != null && tabParam.length > 0) {
    const filterStatus = toFilterStatus(tabParam);
    if (filterStatus != null) {
      return filterStatus;
    }
  }
  return "all";
}

// Format time since last refresh for display
function getTimeSinceRefresh(lastRefreshTime: Date): string {
  const seconds = Math.floor((Date.now() - lastRefreshTime.getTime()) / 1000);
  if (seconds < 5) {
    return "just now";
  }
  if (seconds < 60) {
    return `${String(seconds)}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ago`;
}

const GRID_STYLE = {
  gridTemplateColumns: "repeat(auto-fill, minmax(min(350px, 100%), 1fr))",
  gridAutoFlow: "dense",
} as const;

function SessionListSkeleton() {
  return (
    <div className="grid gap-4 auto-rows-auto" style={GRID_STYLE}>
      {[1, 2, 3].map((i) => (
        <Card key={i} className="border-2">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-6 w-48 flex-1" />
              <Skeleton className="h-5 w-16" />
            </div>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-3/4 mb-3" />
            <div className="flex gap-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
          </CardContent>
          <CardFooter className="border-t-2 pt-4">
            <div className="flex gap-2">
              <Skeleton className="h-10 w-10" />
              <Skeleton className="h-10 w-10" />
              <Skeleton className="h-10 w-10" />
            </div>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

type SessionListProps = {
  onAttach: (session: Session) => void;
  onCreateNew: () => void;
};

export function SessionList({ onAttach, onCreateNew }: SessionListProps) {
  const queryClient = useQueryClient();
  const sessionsQuery = useSessions();
  const healthQuery = useHealthReports();
  const archiveSessionMutation = useArchiveSession();
  const unarchiveSessionMutation = useUnarchiveSession();
  const refreshSessionMutation = useRefreshSession();
  const deleteSessionMutation = useDeleteSession();
  const mergePrMutation = useMergePr();
  const startSessionMutation = useStartSession();
  const recreateSessionMutation = useRecreateSession();
  const cleanupSessionMutation = useCleanupSession();

  const sessions = useMemo(() => {
    return new Map((sessionsQuery.data ?? []).map((s) => [s.id, s]));
  }, [sessionsQuery.data]);

  const isLoading = sessionsQuery.isLoading;
  const error = sessionsQuery.error;

  const healthReports = useMemo(() => {
    if (healthQuery.data == null) return new Map<string, SessionHealthReport>();
    return new Map(
      healthQuery.data.sessions.map((report) => [report.session_id, report]),
    );
  }, [healthQuery.data]);

  const getSessionHealth = useCallback(
    (sessionId: string): SessionHealthReport | undefined => {
      return healthReports.get(sessionId);
    },
    [healthReports],
  );

  // Invalidate queries on WebSocket events
  const handleEvent = useCallback(
    (event: { type: string }) => {
      if (
        event.type === "SessionCreated" ||
        event.type === "SessionUpdated" ||
        event.type === "SessionDeleted"
      ) {
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }
    },
    [queryClient],
  );
  useSessionEvents(handleEvent);

  const [filter, setFilter] = useState<FilterStatus>(getInitialFilter);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: "archive" | "unarchive" | "delete" | "refresh";
    session: Session;
  } | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [lastRefreshTime] = useState(new Date());
  const [, _setTickCounter] = useState(0); // Force re-render for time display

  // Health modal state
  const [showStartupHealthModal, setShowStartupHealthModal] = useState(false);
  const [recreateModalSession, setRecreateModalSession] = useState<{
    session: Session;
    healthReport: SessionHealthReport;
  } | null>(null);
  const [blockedModalSession, setBlockedModalSession] = useState<{
    session: Session;
    healthReport: SessionHealthReport;
  } | null>(null);
  const [_startupHealthCheckDone, _setStartupHealthCheckDone] = useState(false);

  const filteredSessions = useMemo(() => {
    const sessionArray = [...sessions.values()];

    switch (filter) {
      case "running":
        return sessionArray.filter((s) => s.status === SessionStatus.Running);
      case "idle":
        return sessionArray.filter((s) => s.status === SessionStatus.Idle);
      case "completed":
        return sessionArray.filter((s) => s.status === SessionStatus.Completed);
      case "archived":
        return sessionArray.filter((s) => s.status === SessionStatus.Archived);
      case "all":
        return sessionArray.filter((s) => s.status !== SessionStatus.Archived);
    }
  }, [sessions, filter]);

  // Compute unhealthy sessions for the startup modal
  const unhealthySessions = useMemo(() => {
    return [...healthReports.values()].filter(
      (report) => report.state.type !== "Healthy",
    );
  }, [healthReports]);

  const handleEdit = (session: Session) => {
    setEditingSession(session);
  };
  const handleArchive = (session: Session) => {
    setConfirmDialog({ type: "archive", session });
  };
  const handleUnarchive = (session: Session) => {
    setConfirmDialog({ type: "unarchive", session });
  };
  const handleDelete = (session: Session) => {
    setConfirmDialog({ type: "delete", session });
  };

  const handleRefresh = (session: Session) => {
    const healthReport = getSessionHealth(session.id);
    if (healthReport == null) {
      // Fallback to legacy refresh dialog if no health report
      setConfirmDialog({ type: "refresh", session });
    } else {
      // Check if this session has no available actions (blocked)
      if (healthReport.available_actions.length === 0) {
        setBlockedModalSession({ session, healthReport });
      } else {
        setRecreateModalSession({ session, healthReport });
      }
    }
  };

  const handleMergePr = (
    session: Session,
    method: MergeMethod,
    deleteBranch: boolean,
  ) => {
    mergePrMutation.mutate(
      { id: session.id, method, deleteBranch },
      {
        onSuccess: () => {
          toast.success(
            `Pull request for "${session.name}" merged successfully`,
          );
        },
        onError: (caughtError: unknown) => {
          toast.error(
            `Failed to merge PR: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}`,
          );
        },
      },
    );
  };

  const runConfirmAction = async (type: string, sessionObj: Session) => {
    try {
      switch (type) {
        case "archive":
          await archiveSessionMutation.mutateAsync(sessionObj.id);
          toast.success(`Session "${sessionObj.name}" archived`);
          break;
        case "unarchive":
          await unarchiveSessionMutation.mutateAsync(sessionObj.id);
          toast.success(`Session "${sessionObj.name}" restored from archive`);
          break;
        case "refresh":
          await refreshSessionMutation.mutateAsync(sessionObj.id);
          toast.success(`Session "${sessionObj.name}" is being refreshed`);
          break;
        case "delete":
          await deleteSessionMutation.mutateAsync(sessionObj.id);
          toast.info(`Deleting session "${sessionObj.name}"...`);
          break;
      }
    } catch (caughtError: unknown) {
      toast.error(
        `Failed to ${type}: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}`,
      );
    }
  };

  const handleConfirm = () => {
    if (confirmDialog == null) {
      return;
    }

    void runConfirmAction(confirmDialog.type, confirmDialog.session);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b-4 border-primary">
        <h1 className="text-3xl font-bold font-mono uppercase tracking-wider">
          Sessions
        </h1>
        <div className="flex items-center gap-3">
          {/* Auto-refresh indicator */}
          <div className="flex items-center gap-2 px-3 py-1 border-2 border-primary bg-background text-xs font-mono">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-muted-foreground">
              Auto-refresh: {getTimeSinceRefresh(lastRefreshTime)}
            </span>
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["sessions"] });
            }}
            disabled={isLoading}
            aria-label="Refresh sessions"
            className="cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-md"
          >
            <RefreshCw
              className={`w-5 h-5 ${isLoading ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setShowStatusDialog(true);
            }}
            aria-label="System status"
            className="cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-md"
          >
            <Info className="w-5 h-5" />
          </Button>
          <Button
            variant="brutalist"
            onClick={onCreateNew}
            className="cursor-pointer"
          >
            <Plus className="w-5 h-5 mr-2" />
            New Session
          </Button>
        </div>
      </header>

      {/* Filters */}
      <nav className="p-4 border-b-2" aria-label="Session filters">
        <Tabs
          value={filter}
          onValueChange={(v) => {
            const filterStatus = toFilterStatus(v);
            if (filterStatus != null) {
              setFilter(filterStatus);
            }
          }}
        >
          <TabsList className="grid w-full grid-cols-5 border-2 gap-2 p-2">
            <TabsTrigger
              value="all"
              className={`font-semibold ${TAB_TRIGGER_CLASS}`}
            >
              All
            </TabsTrigger>
            <TabsTrigger value="running" className={TAB_TRIGGER_CLASS}>
              Running
            </TabsTrigger>
            <TabsTrigger value="idle" className={TAB_TRIGGER_CLASS}>
              Idle
            </TabsTrigger>
            <TabsTrigger value="completed" className={TAB_TRIGGER_CLASS}>
              Completed
            </TabsTrigger>
            <TabsTrigger value="archived" className={TAB_TRIGGER_CLASS}>
              Archived
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-auto p-4">
        {error != null && (
          <div className="p-4 bg-destructive/10 text-destructive border-2 border-destructive rounded-md mb-4">
            <strong className="font-mono">Error:</strong>{" "}
            {error instanceof Error ? error.message : String(error)}
          </div>
        )}

        {isLoading ? (
          <SessionListSkeleton />
        ) : filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p className="text-lg mb-2 font-semibold">No sessions found</p>
            <p className="text-sm">Create a new session to get started</p>
          </div>
        ) : (
          <div className="grid gap-4 auto-rows-auto" style={GRID_STYLE}>
            {filteredSessions.map((session) => {
              const healthReport = getSessionHealth(session.id);
              return (
                <SessionCard
                  key={session.id}
                  session={session}
                  {...(healthReport === undefined ? {} : { healthReport })}
                  onAttach={onAttach}
                  onEdit={handleEdit}
                  onArchive={handleArchive}
                  onUnarchive={handleUnarchive}
                  onRefresh={handleRefresh}
                  onDelete={handleDelete}
                  onMergePr={handleMergePr}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* Confirmation Dialog */}
      {confirmDialog != null && (
        <ConfirmDialog
          open={true}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setConfirmDialog(null);
            }
          }}
          title={getConfirmDialogTitle(confirmDialog.type)}
          description={getConfirmDialogDescription(
            confirmDialog.type,
            confirmDialog.session.name,
          )}
          confirmLabel={getConfirmDialogLabel(confirmDialog.type)}
          variant={confirmDialog.type === "delete" ? "destructive" : "default"}
          onConfirm={handleConfirm}
        />
      )}

      {/* Edit Dialog */}
      {editingSession != null && (
        <EditSessionDialog
          session={editingSession}
          onClose={() => {
            setEditingSession(null);
          }}
        />
      )}

      {/* Status Dialog */}
      {showStatusDialog && (
        <StatusDialog
          onClose={() => {
            setShowStatusDialog(false);
          }}
        />
      )}

      {/* Startup Health Modal */}
      <StartupHealthModal
        open={showStartupHealthModal}
        onOpenChange={setShowStartupHealthModal}
        unhealthySessions={unhealthySessions}
        onViewSessions={() => {
          // Filter could potentially focus on unhealthy sessions
          // For now just dismiss the modal
        }}
      />

      {/* Recreate Confirm Modal */}
      {recreateModalSession != null && (
        <RecreateModalWrapper
          session={recreateModalSession.session}
          healthReport={recreateModalSession.healthReport}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setRecreateModalSession(null);
            }
          }}
          startSession={(id: string) => startSessionMutation.mutateAsync(id)}
          recreateSession={async (id: string) => {
            await recreateSessionMutation.mutateAsync(id);
          }}
          refreshSession={(id: string) =>
            refreshSessionMutation.mutateAsync(id)
          }
          cleanupSession={(id: string) =>
            cleanupSessionMutation.mutateAsync(id)
          }
        />
      )}

      {/* Recreate Blocked Modal */}
      {blockedModalSession != null && (
        <RecreateBlockedModal
          open={true}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setBlockedModalSession(null);
            }
          }}
          session={blockedModalSession.session}
          healthReport={blockedModalSession.healthReport}
        />
      )}
    </div>
  );
}
