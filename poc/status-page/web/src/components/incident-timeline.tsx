import { useState, useEffect } from "react";
import { getIncidents, type Incident } from "#src/lib/api.ts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "#src/components/ui/card.tsx";
import { Badge } from "#src/components/ui/badge.tsx";
import { Separator } from "#src/components/ui/separator.tsx";
import { cn } from "#src/lib/utils.ts";

const impactColors: Record<Incident["impact"], string> = {
  none: "bg-gray-400 text-white",
  minor: "bg-yellow-500 text-white",
  major: "bg-orange-500 text-white",
  critical: "bg-red-500 text-white",
};

const statusLabels: Record<Incident["status"], string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function IncidentTimeline({ siteId }: { siteId: string }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const result = await getIncidents(siteId);
      if (result.ok) {
        setIncidents(result.data);
      } else {
        setError(result.error);
      }
    };
    void fetchData();
  }, [siteId]);

  if (error !== null) {
    return null;
  }

  const activeIncidents = incidents.filter((i) => i.status !== "resolved");
  const recentResolved = incidents.filter((i) => i.status === "resolved");

  return (
    <div className="space-y-6">
      {activeIncidents.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Active Incidents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activeIncidents.map((incident) => (
                <IncidentCard key={incident.id} incident={incident} />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Incidents</CardTitle>
        </CardHeader>
        <CardContent>
          {recentResolved.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recent incidents to report.
            </p>
          ) : (
            <div className="space-y-4">
              {recentResolved.map((incident) => (
                <IncidentCard key={incident.id} incident={incident} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function IncidentCard({ incident }: { incident: Incident }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">{incident.title}</h4>
        <div className="flex gap-2">
          <Badge
            className={cn("border-transparent", impactColors[incident.impact])}
          >
            {incident.impact}
          </Badge>
          <Badge variant="outline">{statusLabels[incident.status]}</Badge>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatDate(incident.createdAt)}
      </p>
      {incident.updates.length > 0 ? (
        <div className="ml-4 space-y-2 border-l-2 border-muted pl-4">
          {incident.updates.map((update) => (
            <div key={update.id}>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {statusLabels[update.status]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDate(update.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-sm">{update.message}</p>
            </div>
          ))}
        </div>
      ) : null}
      <Separator />
    </div>
  );
}
