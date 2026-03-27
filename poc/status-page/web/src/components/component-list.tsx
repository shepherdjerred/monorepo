import { useState, useEffect } from "react";
import { getComponents, type Component } from "#src/lib/api.ts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "#src/components/ui/card.tsx";
import { Badge } from "#src/components/ui/badge.tsx";
import { cn } from "#src/lib/utils.ts";

const statusColors: Record<Component["status"], string> = {
  operational: "bg-green-500 text-white",
  degraded: "bg-yellow-500 text-white",
  partial_outage: "bg-orange-500 text-white",
  major_outage: "bg-red-500 text-white",
};

const statusLabels: Record<Component["status"], string> = {
  operational: "Operational",
  degraded: "Degraded",
  partial_outage: "Partial Outage",
  major_outage: "Major Outage",
};

export function ComponentList({ siteId }: { siteId: string }) {
  const [components, setComponents] = useState<Component[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const result = await getComponents(siteId);
      if (result.ok) {
        setComponents(
          result.data.toSorted((a, b) => a.displayOrder - b.displayOrder),
        );
      } else {
        setError(result.error);
      }
    };
    void fetchData();
  }, [siteId]);

  if (error !== null) {
    return null;
  }

  if (components.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Components</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {components.map((component) => (
            <div
              key={component.id}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <div>
                <p className="font-medium">{component.name}</p>
                {component.description === null ? null : (
                  <p className="text-sm text-muted-foreground">
                    {component.description}
                  </p>
                )}
              </div>
              <Badge
                className={cn(
                  "border-transparent",
                  statusColors[component.status],
                )}
              >
                {statusLabels[component.status]}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
