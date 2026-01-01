import type { Session } from "@mux/client";
import { SessionStatus } from "@mux/shared";
import { formatRelativeTime } from "../lib/utils";
import { Circle, Archive, Trash2, Terminal } from "lucide-react";

type SessionCardProps = {
  session: Session;
  onAttach: (session: Session) => void;
  onArchive: (session: Session) => void;
  onDelete: (session: Session) => void;
}

export function SessionCard({ session, onAttach, onArchive, onDelete }: SessionCardProps) {
  const statusColors: Record<SessionStatus, string> = {
    [SessionStatus.Creating]: "text-blue-500",
    [SessionStatus.Running]: "text-green-500",
    [SessionStatus.Idle]: "text-yellow-500",
    [SessionStatus.Completed]: "text-gray-500",
    [SessionStatus.Failed]: "text-red-500",
    [SessionStatus.Archived]: "text-gray-400",
  };

  const statusColor = statusColors[session.status];

  return (
    <div className="border rounded-lg p-4 hover:shadow-md transition-shadow bg-card">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Circle className={`w-3 h-3 fill-current ${statusColor}`} />
            <h3 className="font-semibold text-lg">{session.name}</h3>
            <span className="text-xs text-muted-foreground">
              {session.backend}
            </span>
          </div>

          <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
            {session.initial_prompt}
          </p>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{formatRelativeTime(session.created_at)}</span>
            <span>{session.branch_name}</span>
            <span className="px-2 py-0.5 rounded bg-secondary">
              {session.access_mode}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 ml-4">
          {session.status === SessionStatus.Running && (
            <button
              onClick={() => { onAttach(session); }}
              className="p-2 hover:bg-secondary rounded-md transition-colors"
              title="Attach to console"
            >
              <Terminal className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => { onArchive(session); }}
            className="p-2 hover:bg-secondary rounded-md transition-colors"
            title="Archive session"
          >
            <Archive className="w-4 h-4" />
          </button>

          <button
            onClick={() => { onDelete(session); }}
            className="p-2 hover:bg-destructive/10 text-destructive rounded-md transition-colors"
            title="Delete session"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
