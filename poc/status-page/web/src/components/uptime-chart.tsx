import { useState, useEffect } from "react";
import { getUptime, type ComponentUptime } from "#src/lib/api.ts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "#src/components/ui/card.tsx";
import { cn } from "#src/lib/utils.ts";

function getBarColor(percentage: number): string {
  if (percentage >= 99.5) return "bg-green-500";
  if (percentage >= 95) return "bg-yellow-500";
  if (percentage >= 90) return "bg-orange-500";
  return "bg-red-500";
}

function UptimeBar({ entries }: { entries: ComponentUptime["entries"] }) {
  return (
    <div className="flex gap-0.5">
      {entries.map((entry) => (
        <div
          key={entry.date}
          className={cn(
            "h-8 flex-1 rounded-sm transition-opacity hover:opacity-80",
            entry.totalChecks === 0
              ? "bg-gray-300 dark:bg-gray-600"
              : getBarColor(entry.uptimePercentage),
          )}
          title={`${entry.date}: ${entry.totalChecks === 0 ? "No data" : `${entry.uptimePercentage.toFixed(2)}%`}`}
        />
      ))}
    </div>
  );
}

export function UptimeChart({ siteId }: { siteId: string }) {
  const [uptimeData, setUptimeData] = useState<ComponentUptime[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const result = await getUptime(siteId, 90);
      if (result.ok) {
        setUptimeData(result.data);
      } else {
        setError(result.error);
      }
    };
    void fetchData();
  }, [siteId]);

  if (error !== null || uptimeData.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Uptime (90 days)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {uptimeData.map((component) => (
            <div key={component.componentId} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {component.componentName}
                </span>
                <span className="text-sm text-muted-foreground">
                  {component.overallUptime.toFixed(2)}%
                </span>
              </div>
              <UptimeBar entries={component.entries} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>90 days ago</span>
                <span>Today</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
