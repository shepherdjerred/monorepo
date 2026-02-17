import { useState, useMemo, useEffect } from "react";
import type { Session, SessionHealthReport } from "@clauderon/client";
import { SessionStatus } from "@clauderon/shared";
import type { MergeMethod } from "@clauderon/shared";
import { SessionCard } from "./SessionCard";
import { ThemeToggle } from "./ThemeToggle";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusDialog } from "./StatusDialog";
import { EditSessionDialog } from "./EditSessionDialog";
import { StartupHealthModal } from "./StartupHealthModal";
import { RecreateConfirmModal } from "./RecreateConfirmModal";
import { RecreateBlockedModal } from "./RecreateBlockedModal";
import { useSessionContext } from "../contexts/SessionContext";
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

type SessionListProps = {
  onAttach: (session: Session) => void;
  onCreateNew: () => void;
};

type FilterStatus = "all" | "running" | "idle" | "completed" | "archived";

const TAB_TRIGGER_CLASS =
  "cursor-pointer transition-all duration-200 hover:bg-primary/20 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-2 data-[state=active]:border-primary data-[state=active]:shadow-[4px_4px_0_hsl(220,85%,25%)] data-[state=active]:font-bold";

export function SessionList({ onAttach, onCreateNew }: SessionListProps) {
  const {
    sessions,
    isLoading,
    error,
    refreshSessions,
    archiveSession,
    unarchiveSession,
    refreshSession,
    deleteSession,
    mergePr,
    getSessionHealth,
    refreshHealth,
    healthReports,
    startSession,
    wakeSession,
    recreateSession,
    cleanupSession,
  } = useSessionContext();

  // Initialize filter from URL parameter
  const getInitialFilter = (): FilterStatus => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (
      tabParam &&
      ["all", "running", "idle", "completed", "archived"].includes(tabParam)
    ) {
      return tabParam as FilterStatus;
    }
    return "all";
  };

  const [filter, setFilter] = useState<FilterStatus>(getInitialFilter);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: "archive" | "unarchive" | "delete" | "refresh";
    session: Session;
  } | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());
  const [, setTickCounter] = useState(0); // Force re-render for time display

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
  const [startupHealthCheckDone, setStartupHealthCheckDone] = useState(false);

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
      default:
        // "all" tab - exclude archived sessions
        return sessionArray.filter((s) => s.status !== SessionStatus.Archived);
    }
  }, [sessions, filter]);

  // Update URL when filter changes
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", filter);
    window.history.pushState({}, "", url.toString());
  }, [filter]);

  // Auto-refresh every 2 seconds (silent - no loading indicators)
  useEffect(() => {
    const interval = setInterval(() => {
      void Promise.all([refreshSessions(false), refreshHealth()]).then(() => {
        setLastRefreshTime(new Date());
      });
    }, 2000);

    return () => {
      clearInterval(interval);
    };
  }, [refreshSessions, refreshHealth]);

  // Update time display every second
  useEffect(() => {
    const interval = setInterval(() => {
      setTickCounter((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  // Startup health check - show modal if there are unhealthy sessions
  useEffect(() => {
    if (startupHealthCheckDone || isLoading || healthReports.size === 0) {
      return;
    }

    const unhealthySessions = [...healthReports.values()].filter(
      (report) => report.state.type !== "Healthy",
    );

    if (unhealthySessions.length > 0) {
      setShowStartupHealthModal(true);
    }
    setStartupHealthCheckDone(true);
  }, [healthReports, isLoading, startupHealthCheckDone]);

  // Compute unhealthy sessions for the startup modal
  const unhealthySessions = useMemo(() => {
    return [...healthReports.values()].filter(
      (report) => report.state.type !== "Healthy",
    );
  }, [healthReports]);

  // Format last refresh time for display
  const getTimeSinceRefresh = (): string => {
    const seconds = Math.floor((Date.now() - lastRefreshTime.getTime()) / 1000);
    if (seconds < 5) {
      return "just now";
    }
    if (seconds < 60) {
      return `${String(seconds)}s ago`;
    }
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes)}m ago`;
  };

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
    if (healthReport != null) {
      // Check if this session has no available actions (blocked)
      if (healthReport.available_actions.length === 0) {
        setBlockedModalSession({ session, healthReport });
      } else {
        setRecreateModalSession({ session, healthReport });
      }
    } else {
      // Fallback to legacy refresh dialog if no health report
      setConfirmDialog({ type: "refresh", session });
    }
  };

  const handleMergePr = (
    session: Session,
    method: MergeMethod,
    deleteBranch: boolean,
  ) => {
    void mergePr(session.id, method, deleteBranch)
      .then(() => {
        toast.success(`Pull request for "${session.name}" merged successfully`);
      })
      .catch((err: unknown) => {
        toast.error(
          `Failed to merge PR: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  };

  const handleConfirm = () => {
    if (confirmDialog == null) {
      return;
    }

    switch (confirmDialog.type) {
      case "archive": {
        void archiveSession(confirmDialog.session.id)
          .then(() => {
            toast.success(`Session "${confirmDialog.session.name}" archived`);
          })
          .catch((err: unknown) => {
            toast.error(
              `Failed to archive: ${err instanceof Error ? err.message : String(err)}`,
            );
          });

        break;
      }
      case "unarchive": {
        void unarchiveSession(confirmDialog.session.id)
          .then(() => {
            toast.success(
              `Session "${confirmDialog.session.name}" restored from archive`,
            );
          })
          .catch((err: unknown) => {
            toast.error(
              `Failed to unarchive: ${err instanceof Error ? err.message : String(err)}`,
            );
          });

        break;
      }
      case "refresh": {
        void refreshSession(confirmDialog.session.id)
          .then(() => {
            toast.success(
              `Session "${confirmDialog.session.name}" is being refreshed`,
            );
          })
          .catch((err: unknown) => {
            toast.error(
              `Failed to refresh: ${err instanceof Error ? err.message : String(err)}`,
            );
          });

        break;
      }
      default: {
        void deleteSession(confirmDialog.session.id)
          .then(() => {
            toast.info(`Deleting session "${confirmDialog.session.name}"...`);
          })
          .catch((err: unknown) => {
            toast.error(
              `Failed to delete: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }
    }
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
              Auto-refresh: {getTimeSinceRefresh()}
            </span>
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              void refreshSessions(false).then(() => {
                setLastRefreshTime(new Date());
              });
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
            setFilter(v as FilterStatus);
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
            <strong className="font-mono">Error:</strong> {error.message}
          </div>
        )}

        {isLoading ? (
          <div
            className="grid gap-4 auto-rows-auto"
            style={{
              gridTemplateColumns:
                "repeat(auto-fill, minmax(min(350px, 100%), 1fr))",
              gridAutoFlow: "dense",
            }}
          >
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
        ) : filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p className="text-lg mb-2 font-semibold">No sessions found</p>
            <p className="text-sm">Create a new session to get started</p>
          </div>
        ) : (
          <div
            className="grid gap-4 auto-rows-auto"
            style={{
              gridTemplateColumns:
                "repeat(auto-fill, minmax(min(350px, 100%), 1fr))",
              gridAutoFlow: "dense",
            }}
          >
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
          onOpenChange={(open) => {
            if (!open) {
              setConfirmDialog(null);
            }
          }}
          title={
            confirmDialog.type === "archive"
              ? "Archive Session"
              : confirmDialog.type === "unarchive"
                ? "Unarchive Session"
                : confirmDialog.type === "refresh"
                  ? "Refresh Session"
                  : "Delete Session"
          }
          description={
            confirmDialog.type === "archive"
              ? `Are you sure you want to archive "${confirmDialog.session.name}"?`
              : confirmDialog.type === "unarchive"
                ? `Are you sure you want to restore "${confirmDialog.session.name}" from the archive?`
                : confirmDialog.type === "refresh"
                  ? `This will pull the latest image and recreate the container for "${confirmDialog.session.name}". The session history will be preserved.`
                  : `Are you sure you want to delete "${confirmDialog.session.name}"? This action cannot be undone.`
          }
          confirmLabel={
            confirmDialog.type === "archive"
              ? "Archive"
              : confirmDialog.type === "unarchive"
                ? "Unarchive"
                : confirmDialog.type === "refresh"
                  ? "Refresh"
                  : "Delete"
          }
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
        <RecreateConfirmModal
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              setRecreateModalSession(null);
            }
          }}
          session={recreateModalSession.session}
          healthReport={recreateModalSession.healthReport}
          onStart={() => {
            void startSession(recreateModalSession.session.id)
              .then(() => {
                toast.success(
                  `Session "${recreateModalSession.session.name}" started`,
                );
              })
              .catch((err: unknown) => {
                toast.error(
                  `Failed to start: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
          }}
          onWake={() => {
            void wakeSession(recreateModalSession.session.id)
              .then(() => {
                toast.success(
                  `Session "${recreateModalSession.session.name}" is waking up`,
                );
              })
              .catch((err: unknown) => {
                toast.error(
                  `Failed to wake: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
          }}
          onRecreate={() => {
            void recreateSession(recreateModalSession.session.id)
              .then(() => {
                toast.success(
                  `Session "${recreateModalSession.session.name}" is being recreated`,
                );
              })
              .catch((err: unknown) => {
                toast.error(
                  `Failed to recreate: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
          }}
          onRecreateFresh={() => {
            void recreateSession(recreateModalSession.session.id)
              .then(() => {
                toast.success(
                  `Session "${recreateModalSession.session.name}" is being recreated fresh`,
                );
              })
              .catch((err: unknown) => {
                toast.error(
                  `Failed to recreate fresh: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
          }}
          onUpdateImage={() => {
            void refreshSession(recreateModalSession.session.id)
              .then(() => {
                toast.success(
                  `Session "${recreateModalSession.session.name}" is being refreshed with latest image`,
                );
              })
              .catch((err: unknown) => {
                toast.error(
                  `Failed to update image: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
          }}
          onCleanup={() => {
            void cleanupSession(recreateModalSession.session.id)
              .then(() => {
                toast.success(
                  `Session "${recreateModalSession.session.name}" cleaned up`,
                );
              })
              .catch((err: unknown) => {
                toast.error(
                  `Failed to cleanup: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
          }}
        />
      )}

      {/* Recreate Blocked Modal */}
      {blockedModalSession != null && (
        <RecreateBlockedModal
          open={true}
          onOpenChange={(open) => {
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
