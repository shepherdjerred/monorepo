import type { Session } from "@clauderon/client";
import { SessionStatus, BackendType } from "@clauderon/shared";
import {
  Archive,
  ArchiveRestore,
  Trash2,
  Terminal,
  Edit,
  RefreshCw,
  GitMerge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardFooter } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SessionCardFooterProps = {
  session: Session;
  onAttach: (session: Session) => void;
  onEdit: (session: Session) => void;
  onArchive: (session: Session) => void;
  onUnarchive: (session: Session) => void;
  onRefresh: (session: Session) => void;
  onDelete: (session: Session) => void;
  onOpenMergeDialog: () => void;
};

const ACTION_BUTTON_CLASS =
  "cursor-pointer transition-all duration-200 hover:scale-110 active:scale-95 hover:shadow-md";

export function SessionCardFooterBar({
  session,
  onAttach,
  onEdit,
  onArchive,
  onUnarchive,
  onRefresh,
  onDelete,
  onOpenMergeDialog,
}: SessionCardFooterProps) {
  return (
    <CardFooter className="flex gap-2 border-t-2 pt-4 px-6 pb-6 bg-card/50">
      <TooltipProvider>
        {session.status === SessionStatus.Running && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  onAttach(session);
                }}
                aria-label="Attach to console"
                className={ACTION_BUTTON_CLASS}
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
              onClick={() => {
                onEdit(session);
              }}
              aria-label="Edit session"
              className={ACTION_BUTTON_CLASS}
            >
              <Edit className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit title/description</TooltipContent>
        </Tooltip>

        {session.backend === BackendType.Docker && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  onRefresh(session);
                }}
                aria-label="Refresh session"
                className={ACTION_BUTTON_CLASS}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Refresh (pull latest image and recreate)
            </TooltipContent>
          </Tooltip>
        )}

        {session.can_merge_pr && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenMergeDialog}
                aria-label="Merge pull request"
                className={ACTION_BUTTON_CLASS}
              >
                <GitMerge className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Merge pull request</TooltipContent>
          </Tooltip>
        )}

        {session.status === SessionStatus.Archived ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  onUnarchive(session);
                }}
                aria-label="Unarchive session"
                className={ACTION_BUTTON_CLASS}
              >
                <ArchiveRestore className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Restore from archive</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  onArchive(session);
                }}
                aria-label="Archive session"
                className={ACTION_BUTTON_CLASS}
              >
                <Archive className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Archive session</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                onDelete(session);
              }}
              aria-label="Delete session"
              className={`${ACTION_BUTTON_CLASS} text-destructive hover:bg-destructive/10`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete session</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </CardFooter>
  );
}
