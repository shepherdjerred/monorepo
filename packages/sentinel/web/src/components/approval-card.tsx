import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";

type Approval = {
  id: string;
  jobId: string;
  agent: string;
  toolName: string;
  toolInput: string;
  status: string;
  decidedBy: string | null;
  reason: string | null;
  expiresAt: string | Date;
  createdAt: string | Date;
  decidedAt: string | Date | null;
};

type ApprovalCardProps = {
  approval: Approval;
  onViewSession?: () => void;
};

function formatTimeRemaining(expiresAt: string | Date): string {
  const expires = new Date(expiresAt);
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();

  if (diffMs <= 0) return "Expired";

  const minutes = Math.floor(diffMs / 60_000);
  const seconds = Math.floor((diffMs % 60_000) / 1000);

  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    return `${String(hours)}h ${String(minutes % 60)}m remaining`;
  }
  if (minutes > 0) {
    return `${String(minutes)}m ${String(seconds)}s remaining`;
  }
  return `${String(seconds)}s remaining`;
}

function formatTimestamp(value: string | Date | null): string {
  if (value == null) return "-";
  return new Date(value).toLocaleString();
}

function statusVariant(status: string) {
  switch (status) {
    case "approved":
      return "success" as const;
    case "denied":
      return "error" as const;
    case "pending":
      return "warning" as const;
    default:
      return "default" as const;
  }
}

export function ApprovalCard({ approval, onViewSession }: ApprovalCardProps) {
  const [showInput, setShowInput] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(() =>
    formatTimeRemaining(approval.expiresAt),
  );
  const queryClient = useQueryClient();
  const decideMutation = trpc.approval.decide.useMutation({
    onSuccess() {
      void queryClient.invalidateQueries({
        queryKey: [["approval", "list"]],
      });
    },
  });

  useEffect(() => {
    if (approval.status !== "pending") return;

    const interval = setInterval(() => {
      setTimeRemaining(formatTimeRemaining(approval.expiresAt));
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [approval.expiresAt, approval.status]);

  let formattedInput = approval.toolInput;
  try {
    formattedInput = JSON.stringify(JSON.parse(approval.toolInput), null, 2);
  } catch {
    // Use as-is
  }

  const isPending = approval.status === "pending";
  const isExpired = timeRemaining === "Expired";

  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant={statusVariant(approval.status)}>
                {approval.status}
              </Badge>
              <span className="text-sm text-zinc-500">
                {approval.agent}
              </span>
              <span className="text-xs text-zinc-400">
                {formatTimestamp(approval.createdAt)}
              </span>
            </div>

            <p className="mb-1 text-sm font-semibold">{approval.toolName}</p>

            <button
              onClick={() => { setShowInput(!showInput); }}
              className="mb-1 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              {showInput ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Tool Input ({formattedInput.length} chars)
            </button>

            {showInput && (
              <pre className="max-h-60 overflow-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
                <code>{formattedInput}</code>
              </pre>
            )}

            <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
              {isPending ? (
                <span className={isExpired ? "text-red-500" : ""}>
                  {timeRemaining}
                </span>
              ) : (
                <>
                  <span>
                    Decided by {approval.decidedBy ?? "unknown"}
                  </span>
                  {approval.decidedAt != null && (
                    <span>at {formatTimestamp(approval.decidedAt)}</span>
                  )}
                  {approval.reason != null && (
                    <span className="italic">"{approval.reason}"</span>
                  )}
                </>
              )}
              {onViewSession != null && (
                <button
                  onClick={onViewSession}
                  className="flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
                >
                  <MessageSquare size={10} />
                  Session
                </button>
              )}
            </div>
          </div>
          {isPending && !isExpired && (
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="primary"
                className="bg-green-600 hover:bg-green-700 active:bg-green-800"
                disabled={decideMutation.isPending}
                onClick={() => {
                  decideMutation.mutate({
                    id: approval.id,
                    approved: true,
                  });
                }}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={decideMutation.isPending}
                onClick={() => {
                  decideMutation.mutate({
                    id: approval.id,
                    approved: false,
                  });
                }}
              >
                Deny
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
