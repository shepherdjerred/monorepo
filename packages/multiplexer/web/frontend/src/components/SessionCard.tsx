import type { Session } from "@mux/client";
import { SessionStatus } from "@mux/shared";
import { formatRelativeTime } from "../lib/utils";
import { Archive, Trash2, Terminal } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type SessionCardProps = {
  session: Session;
  onAttach: (session: Session) => void;
  onArchive: (session: Session) => void;
  onDelete: (session: Session) => void;
}

export function SessionCard({ session, onAttach, onArchive, onDelete }: SessionCardProps) {
  const statusColors: Record<SessionStatus, string> = {
    [SessionStatus.Creating]: "bg-blue-500",
    [SessionStatus.Running]: "bg-green-500",
    [SessionStatus.Idle]: "bg-yellow-500",
    [SessionStatus.Completed]: "bg-gray-500",
    [SessionStatus.Failed]: "bg-red-500",
    [SessionStatus.Archived]: "bg-gray-400",
  };

  const statusColor = statusColors[session.status];

  return (
    <Card className="border-2 hover:shadow-[4px_4px_0_hsl(var(--foreground))] transition-all">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className={`w-4 h-4 border-2 border-foreground ${statusColor}`} />
          <h3 className="font-bold text-lg flex-1">{session.name}</h3>
          <Badge variant="outline" className="border-2 font-mono text-xs">
            {session.backend}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
          {session.initial_prompt}
        </p>
        <div className="flex items-center gap-4 text-xs">
          <span className="font-mono text-muted-foreground">
            {formatRelativeTime(session.created_at)}
          </span>
          <span className="text-muted-foreground">{session.branch_name}</span>
          <Badge variant="secondary" className="font-mono">
            {session.access_mode}
          </Badge>
        </div>
      </CardContent>
      <CardFooter className="flex gap-2 border-t-2 pt-4">
        <TooltipProvider>
          {session.status === SessionStatus.Running && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { onAttach(session); }}
                  aria-label="Attach to console"
                >
                  <Terminal className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach to console</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { onArchive(session); }}
                aria-label="Archive session"
              >
                <Archive className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Archive session</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { onDelete(session); }}
                aria-label="Delete session"
                className="text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete session</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardFooter>
    </Card>
  );
}
