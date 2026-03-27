import { useState, useEffect } from "react";
import { CheckCircle, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { getStatus, type StatusSummary } from "#src/lib/api.ts";
import { cn } from "#src/lib/utils.ts";

const statusConfig = {
  operational: {
    label: "All Systems Operational",
    className: "bg-green-500 text-white",
    Icon: CheckCircle,
  },
  degraded: {
    label: "Degraded Performance",
    className: "bg-yellow-500 text-white",
    Icon: AlertTriangle,
  },
  partial_outage: {
    label: "Partial System Outage",
    className: "bg-orange-500 text-white",
    Icon: AlertTriangle,
  },
  major_outage: {
    label: "Major System Outage",
    className: "bg-red-500 text-white",
    Icon: XCircle,
  },
} as const;

type StatusOverviewProps = {
  siteId: string;
  initialStatus?: StatusSummary;
};

export function StatusOverview({ siteId, initialStatus }: StatusOverviewProps) {
  const [status, setStatus] = useState(
    initialStatus ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialStatus !== undefined) return;

    const fetchData = async () => {
      const result = await getStatus(siteId);
      if (result.ok) {
        setStatus(result.data);
      } else {
        setError(result.error);
      }
    };
    void fetchData();
  }, [initialStatus, siteId]);

  if (error !== null) {
    return (
      <div className="rounded-lg bg-gray-400 p-6 text-center text-white">
        <div className="flex items-center justify-center gap-2">
          <HelpCircle className="h-6 w-6" />
          <span className="text-xl font-semibold">
            Unable to fetch live status
          </span>
        </div>
      </div>
    );
  }

  if (status === null) {
    return (
      <div className="rounded-lg bg-muted p-6 text-center">
        <span className="text-muted-foreground">Loading status...</span>
      </div>
    );
  }

  const config = statusConfig[status.status];
  const { Icon } = config;

  return (
    <div className={cn("rounded-lg p-6 text-center", config.className)}>
      <div className="flex items-center justify-center gap-2">
        <Icon className="h-6 w-6" />
        <span className="text-xl font-semibold">{config.label}</span>
      </div>
    </div>
  );
}
