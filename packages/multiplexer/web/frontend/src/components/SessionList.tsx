import { useState, useMemo } from "react";
import type { Session } from "@mux/client";
import { SessionStatus } from "@mux/shared";
import { SessionCard } from "./SessionCard";
import { useSessionContext } from "../contexts/SessionContext";
import { Plus, RefreshCw, Info } from "lucide-react";
import { StatusDialog } from "./StatusDialog";

type SessionListProps = {
  onAttach: (session: Session) => void;
  onCreateNew: () => void;
}

type FilterStatus = "all" | "running" | "idle" | "completed" | "archived";

export function SessionList({ onAttach, onCreateNew }: SessionListProps) {
  const { sessions, isLoading, error, refreshSessions, archiveSession, deleteSession } =
    useSessionContext();
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [showStatusDialog, setShowStatusDialog] = useState(false);

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
        return sessionArray;
    }
  }, [sessions, filter]);

  const handleArchive = (session: Session) => {
    if (confirm(`Archive session "${session.name}"?`)) {
      void archiveSession(session.id);
    }
  };

  const handleDelete = (session: Session) => {
    if (confirm(`Delete session "${session.name}"? This cannot be undone.`)) {
      void deleteSession(session.id);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <div className="flex gap-2">
          <button
            onClick={() => { void refreshSessions(); }}
            className="p-2 hover:bg-secondary rounded-md transition-colors"
            disabled={isLoading}
            title="Refresh sessions"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => { setShowStatusDialog(true); }}
            className="p-2 hover:bg-secondary rounded-md transition-colors"
            title="System Status"
          >
            <Info className="w-5 h-5" />
          </button>
          <button
            onClick={onCreateNew}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Session
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 p-4 border-b">
        {(["all", "running", "idle", "completed", "archived"] as const).map((status) => (
          <button
            key={status}
            onClick={() => { setFilter(status); }}
            className={`px-3 py-1 rounded-md text-sm capitalize transition-colors ${
              filter === status
                ? "bg-primary text-primary-foreground"
                : "hover:bg-secondary"
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive rounded-md mb-4">
            Error: {error.message}
          </div>
        )}

        {filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p className="text-lg mb-2">No sessions found</p>
            <p className="text-sm">Create a new session to get started</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onAttach={onAttach}
                onArchive={handleArchive}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status Dialog */}
      {showStatusDialog && (
        <StatusDialog onClose={() => { setShowStatusDialog(false); }} />
      )}
    </div>
  );
}
