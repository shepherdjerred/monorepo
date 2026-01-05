import { useState, useMemo, useEffect } from "react";
import type { Session } from "@clauderon/client";
import { SessionStatus } from "@clauderon/shared";
import { SessionCard } from "./SessionCard";
import { ThemeToggle } from "./ThemeToggle";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusDialog } from "./StatusDialog";
import { EditSessionDialog } from "./EditSessionDialog";
import { useSessionContext } from "../contexts/SessionContext";
import { toast } from "sonner";
import { Plus, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type SessionListProps = {
  onAttach: (session: Session) => void;
  onCreateNew: () => void;
}

type FilterStatus = "all" | "running" | "idle" | "completed" | "archived";

const TAB_TRIGGER_CLASS = "cursor-pointer transition-all duration-200 hover:bg-primary/20 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-b-4 data-[state=active]:border-foreground";

export function SessionList({ onAttach, onCreateNew }: SessionListProps) {
  const { sessions, isLoading, error, refreshSessions, archiveSession, deleteSession } =
    useSessionContext();

  // Initialize filter from URL parameter
  const getInitialFilter = (): FilterStatus => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (tabParam && ["all", "running", "idle", "completed", "archived"].includes(tabParam)) {
      return tabParam as FilterStatus;
    }
    return "all";
  };

  const [filter, setFilter] = useState<FilterStatus>(getInitialFilter);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: "archive" | "delete";
    session: Session;
  } | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());
  const [, setTickCounter] = useState(0); // Force re-render for time display

  const filteredSessions = useMemo(() => {
    const sessionArray = Array.from(sessions.values());

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

  // Auto-refresh every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void refreshSessions().then(() => {
        setLastRefreshTime(new Date());
      });
    }, 2000);

    return () => { clearInterval(interval); };
  }, [refreshSessions]);

  // Update time display every second
  useEffect(() => {
    const interval = setInterval(() => {
      setTickCounter(prev => prev + 1);
    }, 1000);

    return () => { clearInterval(interval); };
  }, []);

  // Format last refresh time for display
  const getTimeSinceRefresh = (): string => {
    const seconds = Math.floor((Date.now() - lastRefreshTime.getTime()) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  const handleEdit = (session: Session) => {
    setEditingSession(session);
  };

  const handleArchive = (session: Session) => {
    setConfirmDialog({ type: "archive", session });
  };

  const handleDelete = (session: Session) => {
    setConfirmDialog({ type: "delete", session });
  };

  const handleConfirm = () => {
    if (!confirmDialog) return;

    if (confirmDialog.type === "archive") {
      void archiveSession(confirmDialog.session.id).then(() => {
        toast.success(`Session "${confirmDialog.session.name}" archived`);
      }).catch((err) => {
        toast.error(`Failed to archive: ${err instanceof Error ? err.message : String(err)}`);
      });
    } else {
      void deleteSession(confirmDialog.session.id).then(() => {
        toast.info(`Deleting session "${confirmDialog.session.name}"...`);
      }).catch((err) => {
        toast.error(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b-4 border-primary">
        <h1 className="text-3xl font-bold font-mono uppercase tracking-wider">Sessions</h1>
        <div className="flex items-center gap-3">
          {/* Auto-refresh indicator */}
          <div className="flex items-center gap-2 px-3 py-1 border-2 border-primary bg-background text-xs font-mono">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-muted-foreground">Auto-refresh: {getTimeSinceRefresh()}</span>
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              void refreshSessions().then(() => {
                setLastRefreshTime(new Date());
              });
            }}
            disabled={isLoading}
            aria-label="Refresh sessions"
            className="cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-md"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { setShowStatusDialog(true); }}
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
        <Tabs value={filter} onValueChange={(v) => { setFilter(v as FilterStatus); }}>
          <TabsList className="grid w-full grid-cols-5 border-2">
            <TabsTrigger
              value="all"
              className={`font-semibold ${TAB_TRIGGER_CLASS}`}
            >
              All
            </TabsTrigger>
            <TabsTrigger
              value="running"
              className={TAB_TRIGGER_CLASS}
            >
              Running
            </TabsTrigger>
            <TabsTrigger
              value="idle"
              className={TAB_TRIGGER_CLASS}
            >
              Idle
            </TabsTrigger>
            <TabsTrigger
              value="completed"
              className={TAB_TRIGGER_CLASS}
            >
              Completed
            </TabsTrigger>
            <TabsTrigger
              value="archived"
              className={TAB_TRIGGER_CLASS}
            >
              Archived
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-auto p-4">
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive border-2 border-destructive rounded-md mb-4">
            <strong className="font-mono">Error:</strong> {error.message}
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
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
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filteredSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onAttach={onAttach}
                onEdit={handleEdit}
                onArchive={handleArchive}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              setConfirmDialog(null);
            }
          }}
          title={confirmDialog.type === "archive" ? "Archive Session" : "Delete Session"}
          description={
            confirmDialog.type === "archive"
              ? `Are you sure you want to archive "${confirmDialog.session.name}"?`
              : `Are you sure you want to delete "${confirmDialog.session.name}"? This action cannot be undone.`
          }
          confirmLabel={confirmDialog.type === "archive" ? "Archive" : "Delete"}
          variant={confirmDialog.type === "delete" ? "destructive" : "default"}
          onConfirm={handleConfirm}
        />
      )}

      {/* Edit Dialog */}
      {editingSession && (
        <EditSessionDialog
          session={editingSession}
          onClose={() => { setEditingSession(null); }}
        />
      )}

      {/* Status Dialog */}
      {showStatusDialog && (
        <StatusDialog onClose={() => { setShowStatusDialog(false); }} />
      )}
    </div>
  );
}
