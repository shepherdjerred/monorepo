import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReportIdSchema } from "@scout-for-lol/data";
import { CronPresets } from "@scout-for-lol/data/model/competition-cron.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import { Badge } from "#src/components/ui/badge.tsx";
import { ReportRunStatusBadge } from "#src/components/status-badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

function cronLabel(cron: string): string {
  const preset = CronPresets.find((entry) => entry.value === cron);
  return preset?.label ?? cron;
}

export function ReportList() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // Default to hiding disabled reports; the toggle shows all.
  const [enabledOnly, setEnabledOnly] = useState(true);
  const safeGuildId = guildId ?? "";

  const listKey = trpc.report.list.queryKey({ guildId: safeGuildId });
  const reportsQuery = useQuery(
    trpc.report.list.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined },
    ),
  );
  const setEnabledMutation = useMutation(
    trpc.report.setEnabled.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: listKey });
      },
    }),
  );

  if (guildId === undefined) {
    return <p className="text-sm text-destructive">Missing guild id</p>;
  }

  const reports = reportsQuery.data ?? [];
  const visibleReports = enabledOnly
    ? reports.filter((report) => report.isEnabled)
    : reports;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Reports</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={enabledOnly ? "default" : "outline"}
            onClick={() => {
              setEnabledOnly((prev) => !prev);
            }}
          >
            {enabledOnly ? "Enabled only" : "All"}
          </Button>
          <Button asChild size="sm">
            <Link to={`/g/${guildId}/reports/new`}>+ New report</Link>
          </Button>
        </div>
      </div>

      {reportsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading reports…</p>
      )}
      {reportsQuery.error && (
        <p className="text-sm text-destructive">
          Failed to load: {reportsQuery.error.message}
        </p>
      )}
      {setEnabledMutation.error && (
        <p className="text-sm text-destructive">
          {setEnabledMutation.error.message}
        </p>
      )}

      {reportsQuery.data && reports.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No reports yet — click &quot;New report&quot; to get started.
        </p>
      )}
      {reports.length > 0 && visibleReports.length === 0 && (
        <p className="text-sm text-muted-foreground">
          All reports are disabled — switch the toggle to &quot;All&quot; to see
          them.
        </p>
      )}

      {visibleReports.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleReports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="font-medium">
                    <Link
                      className="underline"
                      to={`/g/${guildId}/reports/${report.id.toString()}`}
                    >
                      {report.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {cronLabel(report.cronExpression)}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={
                        report.isSystemManaged || setEnabledMutation.isPending
                      }
                      onClick={() => {
                        setEnabledMutation.mutate({
                          guildId,
                          reportId: ReportIdSchema.parse(report.id),
                          isEnabled: !report.isEnabled,
                        });
                      }}
                    >
                      {report.isEnabled ? "On" : "Off"}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <ReportRunStatusBadge status={report.lastRunStatus} />
                  </TableCell>
                  <TableCell>
                    {report.isSystemManaged ? (
                      <Badge variant="outline">System</Badge>
                    ) : (
                      <span className="text-muted-foreground">User</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
