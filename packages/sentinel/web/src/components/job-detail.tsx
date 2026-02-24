import { useQueryClient } from "@tanstack/react-query";
import type { Page } from "@/app";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare } from "lucide-react";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";

const statusVariant: Record<string, BadgeVariant> = {
  pending: "default",
  running: "info",
  completed: "success",
  failed: "error",
  cancelled: "warning",
  awaiting_approval: "warning",
};

const priorityLabels: Record<number, string> = {
  0: "Critical",
  1: "High",
  2: "Normal",
  3: "Low",
};

function formatTimestamp(value: string | Date | null | undefined): string {
  if (value == null) return "-";
  return new Date(value).toLocaleString();
}

type JobDetailProps = {
  jobId: string;
  onNavigate: (page: Page) => void;
};

export function JobDetail({ jobId, onNavigate }: JobDetailProps) {
  const job = trpc.job.byId.useQuery({ id: jobId });
  const conversation = trpc.conversation.byJob.useQuery(
    { jobId },
    { enabled: job.data != null },
  );
  const queryClient = useQueryClient();
  const cancelJob = trpc.job.cancel.useMutation({
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });

  if (job.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (job.data == null) {
    return (
      <div className="text-center text-zinc-500 dark:text-zinc-400">
        Job not found
      </div>
    );
  }

  const data = job.data;
  const conversationFile = conversation.data?.file;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Job Detail
        </h1>
        <Badge variant={statusVariant[data.status] ?? "default"}>
          {data.status}
        </Badge>
        {data.status === "pending" && (
          <Button
            variant="danger"
            size="sm"
            disabled={cancelJob.isPending}
            onClick={() => { cancelJob.mutate({ id: jobId }); }}
          >
            {cancelJob.isPending ? "Cancelling..." : "Cancel Job"}
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
              Overview
            </h2>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Agent</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {data.agent}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Priority</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {priorityLabels[data.priority] ?? `P${String(data.priority)}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Trigger Source</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {data.triggerSource}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Retry</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {data.retryCount} / {data.maxRetries}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
              Timestamps
            </h2>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Created</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formatTimestamp(data.createdAt)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Claimed</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formatTimestamp(data.claimedAt)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Completed</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formatTimestamp(data.completedAt)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {data.triggerMetadata !== "{}" && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
              Trigger Metadata
            </h2>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-md bg-zinc-100 p-4 text-sm dark:bg-zinc-800">
              {JSON.stringify(data.triggerMetadata, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Prompt</h2>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-zinc-100 p-4 text-sm dark:bg-zinc-800">
            {data.prompt}
          </pre>
        </CardContent>
      </Card>

      {data.result != null && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
              Result
            </h2>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-zinc-100 p-4 text-sm dark:bg-zinc-800">
              {data.result}
            </pre>
          </CardContent>
        </Card>
      )}

      {conversationFile != null && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
              Conversation
            </h2>
          </CardHeader>
          <CardContent>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onNavigate({
                  name: "conversation",
                  sessionId: conversationFile.sessionId,
                });
              }}
            >
              <MessageSquare size={14} className="mr-1" />
              View Conversation
            </Button>
            <p className="mt-2 text-xs text-zinc-500">
              Session: {conversationFile.sessionId.slice(0, 8)}...
              {" | "}Agent: {conversationFile.agent}
            </p>
          </CardContent>
        </Card>
      )}

      <Button
        variant="ghost"
        onClick={() => { onNavigate({ name: "jobs" }); }}
      >
        Back to Jobs
      </Button>
    </div>
  );
}
