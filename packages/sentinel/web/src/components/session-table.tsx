import type { Page } from "@/app";
import { Badge } from "@/components/ui/badge";
import { MessageSquare } from "lucide-react";

type Session = {
  id: string;
  agent: string;
  jobId: string;
  startedAt: string | Date;
  endedAt: string | Date | null;
  turnsUsed: number;
  status: string;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
};

type SessionTableProps = {
  sessions: Session[];
  onNavigate?: (page: Page) => void;
};

function statusVariant(status: string) {
  switch (status) {
    case "running":
      return "info" as const;
    case "completed":
      return "success" as const;
    case "failed":
      return "error" as const;
    default:
      return "default" as const;
  }
}

function formatRelativeTime(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${String(days)}d ago`;
  if (hours > 0) return `${String(hours)}h ago`;
  if (minutes > 0) return `${String(minutes)}m ago`;
  return `${String(seconds)}s ago`;
}

const headerClass =
  "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400";
const cellClass =
  "whitespace-nowrap px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300";

export function SessionTable({ sessions, onNavigate }: SessionTableProps) {
  if (sessions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">
        No sessions found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
        <thead className="bg-zinc-50 dark:bg-zinc-900">
          <tr>
            <th className={headerClass}>Status</th>
            <th className={headerClass}>Agent</th>
            <th className={headerClass}>Job ID</th>
            <th className={headerClass}>Started</th>
            <th className={headerClass}>Ended</th>
            <th className={headerClass}>Turns</th>
            <th className={headerClass}>Tokens</th>
            <th className={headerClass}>Error</th>
            {onNavigate != null && <th className={headerClass}></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
          {sessions.map((session) => (
            <tr key={session.id}>
              <td className={cellClass}>
                <Badge variant={statusVariant(session.status)}>
                  {session.status}
                </Badge>
              </td>
              <td className={cellClass}>{session.agent}</td>
              <td className={cellClass}>
                <span className="font-mono text-xs">{session.jobId}</span>
              </td>
              <td className={cellClass}>
                {formatRelativeTime(session.startedAt)}
              </td>
              <td className={cellClass}>
                {session.endedAt == null
                  ? "—"
                  : formatRelativeTime(session.endedAt)}
              </td>
              <td className={cellClass}>{session.turnsUsed}</td>
              <td className={cellClass}>
                <span className="font-mono text-xs">
                  {session.inputTokens.toLocaleString()} /{" "}
                  {session.outputTokens.toLocaleString()}
                </span>
              </td>
              <td className={cellClass}>
                {session.error == null ? (
                  "—"
                ) : (
                  <span
                    className="max-w-xs truncate text-red-600 dark:text-red-400"
                    title={session.error}
                  >
                    {session.error}
                  </span>
                )}
              </td>
              {onNavigate != null && (
                <td className={cellClass}>
                  <button
                    onClick={() => {
                      onNavigate({ name: "conversation", sessionId: session.id });
                    }}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
                    title="View Conversation"
                  >
                    <MessageSquare size={12} />
                    <span>Conversation</span>
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
