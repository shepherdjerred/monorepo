import type { Page } from "@/app";
import { Badge } from "@/components/ui/badge";

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

function formatRelativeTime(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) return `${String(diffSeconds)}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${String(diffMinutes)}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${String(diffHours)}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${String(diffDays)}d ago`;
}

type Job = {
  id: string;
  status: string;
  agent: string;
  triggerSource: string;
  priority: number;
  createdAt: string | Date;
};

type JobTableProps = {
  jobs: Job[];
  onNavigate: (page: Page) => void;
};

export function JobTable({ jobs, onNavigate }: JobTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Agent</th>
            <th className="px-4 py-3 font-medium">Trigger</th>
            <th className="px-4 py-3 font-medium">Priority</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr
              key={job.id}
              onClick={() => { onNavigate({ name: "job-detail", jobId: job.id }); }}
              className="cursor-pointer border-b border-zinc-100 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <td className="px-4 py-3">
                <Badge variant={statusVariant[job.status] ?? "default"}>
                  {job.status}
                </Badge>
              </td>
              <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                {job.agent}
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {job.triggerSource}
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {priorityLabels[job.priority] ?? `P${String(job.priority)}`}
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {formatRelativeTime(job.createdAt)}
              </td>
              <td className="px-4 py-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate({ name: "job-detail", jobId: job.id });
                  }}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  View
                </button>
              </td>
            </tr>
          ))}
          {jobs.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400"
              >
                No jobs found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
