import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import { ErrorPanel } from "#src/components/route-error-panel.tsx";
import { useHallParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

function recordValue(value: number | null, precision: number): string {
  return value === null ? "—" : value.toFixed(precision);
}

export function HallOfFame() {
  const { guildId } = useHallParams();
  const trpc = useTRPC();
  const hall = useQuery(trpc.hall.get.queryOptions({ guildId }));

  if (hall.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:py-12">
        <p className="text-sm text-scout-subtle">Building the Hall…</p>
      </div>
    );
  }
  if (hall.isError) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:py-12">
        <ErrorPanel
          title="Unable to load Hall of Fame"
          message={hall.error.message}
          onRetry={() => {
            void hall.refetch();
          }}
        />
      </div>
    );
  }
  const recordById = new Map(
    hall.data.catalog.hall.records.map((record) => [record.id, record]),
  );
  const entriesByFamily = Map.groupBy(
    hall.data.entries,
    (entry) => entry.queueFamilyId,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:py-12">
      <header className="space-y-2">
        <p className="text-sm font-medium text-primary">Guild records</p>
        <h1 className="text-3xl font-semibold tracking-tight">Hall of Fame</h1>
        <p className="max-w-2xl text-scout-subtle">
          Best performances from completed, non-remake games Scout recorded
          after each account began guild tracking. Customs and duels are never
          included.
        </p>
      </header>

      {hall.data.settings.enabledQueueFamilies.map((familyId) => {
        const family = hall.data.catalog.hall.queueFamilies.find(
          (candidate) => candidate.id === familyId,
        );
        const entries = entriesByFamily.get(familyId) ?? [];
        if (family === undefined) return null;
        return (
          <Card key={familyId}>
            <CardHeader>
              <CardTitle>{family.label}</CardTitle>
              <CardDescription>{family.queues.join(" · ")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Record</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Holder</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const record = recordById.get(entry.recordId);
                    if (record === undefined) return null;
                    return (
                      <TableRow key={entry.recordId}>
                        <TableCell className="font-medium">
                          {record.label}
                        </TableCell>
                        <TableCell>
                          {recordValue(entry.currentValue, record.precision)}
                        </TableCell>
                        <TableCell>
                          {entry.holders.length === 0
                            ? "—"
                            : entry.holders
                                .map((holder) => holder.playerAlias)
                                .join(", ")}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              entry.baselineStatus === "failed"
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {entry.baselineStatus}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      <p className="text-sm text-scout-subtle">
        Guild administrators can choose queues, records, and the announcement
        channel in{" "}
        <Link className="underline" to={`/g/${guildId}/hall-of-fame`}>
          Hall settings
        </Link>
        .
      </p>
    </div>
  );
}
