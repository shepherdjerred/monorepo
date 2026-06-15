import { useState } from "react";
import type { Page } from "@/app";
import { trpc } from "@/lib/trpc";
import { JobTable } from "@/components/job-table";
import { CreateJobDialog } from "@/components/create-job-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval";

type JobsProps = {
  onNavigate: (page: Page) => void;
};

const statusOptions = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "awaiting_approval", label: "Awaiting Approval" },
];

export function Jobs({ onNavigate }: JobsProps) {
  const [statusFilter, setStatusFilter] = useState<JobStatus | "">("");
  const [agentFilter, setAgentFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const agents = trpc.agent.list.useQuery();
  const jobs = trpc.job.list.useQuery({
    status: statusFilter === "" ? undefined : statusFilter,
    agent: agentFilter === "" ? undefined : agentFilter,
    limit: 50,
  });

  const agentOptions = [
    { value: "", label: "All agents" },
    ...(agents.data == null
      ? []
      : agents.data.map((a) => ({ value: a.name, label: a.name }))),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Jobs
        </h1>
        <Button
          onClick={() => {
            setDialogOpen(true);
          }}
        >
          Create Job
        </Button>
      </div>

      <div className="flex gap-4">
        <Select
          options={statusOptions}
          value={statusFilter}
          onChange={(e) => {
            const val = e.target.value;
            if (
              val === "" ||
              val === "pending" ||
              val === "running" ||
              val === "completed" ||
              val === "failed" ||
              val === "cancelled" ||
              val === "awaiting_approval"
            ) {
              setStatusFilter(val);
            }
          }}
        />
        <Select
          options={agentOptions}
          value={agentFilter}
          onChange={(e) => {
            setAgentFilter(e.target.value);
          }}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <JobTable jobs={jobs.data?.jobs ?? []} onNavigate={onNavigate} />
        </CardContent>
      </Card>

      {jobs.data?.nextCursor != null && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void 0}>
            Load more
          </Button>
        </div>
      )}

      <CreateJobDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
      />
    </div>
  );
}
