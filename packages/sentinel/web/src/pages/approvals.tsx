import { useState, useCallback } from "react";
import type { Page } from "@/app";
import { trpc } from "@/lib/trpc";
import { useSSE } from "@/hooks/use-sse";
import { useQueryClient } from "@tanstack/react-query";
import { ApprovalCard } from "@/components/approval-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type StatusFilter = "all" | "pending" | "approved" | "denied";

const filters: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
];

type ApprovalsProps = {
  onNavigate: (page: Page) => void;
};

export function Approvals({ onNavigate }: ApprovalsProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [agentFilter, setAgentFilter] = useState("");
  const [toolFilter, setToolFilter] = useState("");
  const queryClient = useQueryClient();

  const { data: approvals, isLoading } = trpc.approval.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 100,
  });

  const onSSEEvent = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: [["approval", "list"]],
    });
  }, [queryClient]);

  useSSE("approval:created", onSSEEvent);
  useSSE("approval:decided", onSSEEvent);

  const lowerAgent = agentFilter.toLowerCase();
  const lowerTool = toolFilter.toLowerCase();

  const filteredApprovals = approvals?.filter((a) => {
    if (lowerAgent.length > 0 && !a.agent.toLowerCase().includes(lowerAgent)) {
      return false;
    }
    if (lowerTool.length > 0 && !a.toolName.toLowerCase().includes(lowerTool)) {
      return false;
    }
    return true;
  });

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        Approvals
      </h2>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          {filters.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={statusFilter === f.value ? "primary" : "secondary"}
              onClick={() => {
                setStatusFilter(f.value);
              }}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Filter by agent..."
            value={agentFilter}
            onChange={(e) => {
              setAgentFilter(e.target.value);
            }}
            className="h-8 w-40 text-xs"
          />
          <Input
            placeholder="Filter by tool..."
            value={toolFilter}
            onChange={(e) => {
              setToolFilter(e.target.value);
            }}
            className="h-8 w-40 text-xs"
          />
        </div>
        {filteredApprovals != null && (
          <span className="text-xs text-zinc-500">
            {filteredApprovals.length} result
            {filteredApprovals.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {isLoading && (
        <p className="py-8 text-center text-sm text-zinc-500">Loading...</p>
      )}

      {filteredApprovals?.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-500">
          No approvals found.
        </p>
      )}

      {filteredApprovals != null && filteredApprovals.length > 0 && (
        <div className="space-y-4">
          {filteredApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onViewSession={() => {
                onNavigate({ name: "conversation", sessionId: approval.jobId });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
