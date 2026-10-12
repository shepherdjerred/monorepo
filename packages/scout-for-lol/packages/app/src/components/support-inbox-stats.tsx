import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/query/trpc.ts";

export function SupportInboxStats() {
  const trpc = useTRPC();
  const stats = useQuery(
    trpc.operations.inbox.stats.queryOptions(undefined, {
      refetchInterval: 30_000,
    }),
  );
  return (
    <>
      {stats.error !== null && <p role="alert">{stats.error.message}</p>}
      {stats.data !== undefined && (
        <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
          <h2 className="font-semibold">
            Last 14 days · excluding operator test conversations
          </h2>
          <p>
            {stats.data.contributors} contributors ·{" "}
            {stats.data.deliveryFailures} delivery problems · Average first
            reply:{" "}
            {stats.data.averageFirstResponseSeconds === null
              ? "not available yet"
              : `${Math.round(stats.data.averageFirstResponseSeconds / 60).toString()} minutes`}
          </p>
          <p>
            {stats.data.labelled
              .map(
                (row) =>
                  `${row.category ?? "Unlabelled"}: ${row._count.toString()}`,
              )
              .join(" · ") || "No labelled conversations yet"}
          </p>
          <p>
            {stats.data.touchpoints
              .map(
                (row) =>
                  `${row.surface.toLowerCase()} ${row.action.toLowerCase()}: ${row._count.toString()}`,
              )
              .join(" · ") || "No Discord help actions yet"}
            . Delivered means posted, not seen.
          </p>
        </div>
      )}
    </>
  );
}
