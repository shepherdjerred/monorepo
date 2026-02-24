import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { useSSE } from "@/hooks/use-sse";

const statItems: {
  key: "pending" | "running" | "completed" | "failed" | "cancelled" | "awaitingApproval";
  label: string;
  color: string;
}[] = [
  { key: "pending", label: "Pending", color: "text-zinc-600 dark:text-zinc-400" },
  { key: "running", label: "Running", color: "text-blue-600 dark:text-blue-400" },
  { key: "completed", label: "Completed", color: "text-green-600 dark:text-green-400" },
  { key: "failed", label: "Failed", color: "text-red-600 dark:text-red-400" },
  { key: "cancelled", label: "Cancelled", color: "text-yellow-600 dark:text-yellow-400" },
  { key: "awaitingApproval", label: "Awaiting Approval", color: "text-orange-600 dark:text-orange-400" },
];

export function StatsBar() {
  const stats = trpc.stats.queue.useQuery();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  useSSE("job:created", invalidate);
  useSSE("job:updated", invalidate);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {statItems.map((item) => (
        <Card key={item.key}>
          <CardContent className="py-3">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {item.label}
            </p>
            <p className={`mt-1 text-2xl font-bold ${item.color}`}>
              {stats.data == null ? "-" : stats.data[item.key]}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
