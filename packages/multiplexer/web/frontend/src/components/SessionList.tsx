import { useState, useMemo } from "react";
import type { Session } from "@mux/client";
import { SessionStatus } from "@mux/shared";
import { SessionCard } from "./SessionCard";
import { ThemeToggle } from "./ThemeToggle";
import { useSessionContext } from "../contexts/SessionContext";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type SessionListProps = {
  onAttach: (session: Session) => void;
  onCreateNew: () => void;
}

type FilterStatus = "all" | "running" | "idle" | "completed" | "archived";

export function SessionList({ onAttach, onCreateNew }: SessionListProps) {
  const { sessions, isLoading, error, refreshSessions, archiveSession, deleteSession } =
    useSessionContext();
  const [filter, setFilter] = useState<FilterStatus>("all");

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
      <header className="flex items-center justify-between p-4 border-b-4 border-primary">
        <h1 className="text-3xl font-bold font-mono uppercase tracking-wider">Sessions</h1>
        <div className="flex gap-3">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { void refreshSessions(); }}
            disabled={isLoading}
            aria-label="Refresh sessions"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="brutalist" onClick={onCreateNew}>
            <Plus className="w-5 h-5 mr-2" />
            New Session
          </Button>
        </div>
      </header>

      {/* Filters */}
      <nav className="p-4 border-b-2" aria-label="Session filters">
        <Tabs value={filter} onValueChange={(v) => { setFilter(v as FilterStatus); }}>
          <TabsList className="grid w-full grid-cols-5 border-2">
            <TabsTrigger value="all" className="font-semibold">All</TabsTrigger>
            <TabsTrigger value="running">Running</TabsTrigger>
            <TabsTrigger value="idle">Idle</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
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
                onArchive={handleArchive}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
