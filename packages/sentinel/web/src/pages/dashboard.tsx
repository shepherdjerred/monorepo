import type { Page } from "@/app";
import { trpc } from "@/lib/trpc";
import { StatsBar } from "@/components/stats-bar";
import { JobTable } from "@/components/job-table";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type DashboardProps = {
  onNavigate: (page: Page) => void;
};

export function Dashboard({ onNavigate }: DashboardProps) {
  const recentJobs = trpc.job.list.useQuery({ limit: 10 });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        Dashboard
      </h1>
      <StatsBar />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Recent Jobs
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onNavigate({ name: "jobs" });
            }}
          >
            View all jobs
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <JobTable
            jobs={recentJobs.data?.jobs ?? []}
            onNavigate={onNavigate}
          />
        </CardContent>
      </Card>
    </div>
  );
}
