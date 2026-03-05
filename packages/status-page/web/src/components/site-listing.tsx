import { useState, useEffect } from "react";
import {
  getSites,
  getStatus,
  type Site,
  type StatusSummary,
} from "#src/lib/api.ts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "#src/components/ui/card.tsx";
import { Badge } from "#src/components/ui/badge.tsx";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "#src/lib/utils.ts";

const statusConfig = {
  operational: {
    label: "Operational",
    className: "bg-green-500 text-white",
    Icon: CheckCircle,
  },
  degraded: {
    label: "Degraded",
    className: "bg-yellow-500 text-white",
    Icon: AlertTriangle,
  },
  partial_outage: {
    label: "Partial Outage",
    className: "bg-orange-500 text-white",
    Icon: AlertTriangle,
  },
  major_outage: {
    label: "Major Outage",
    className: "bg-red-500 text-white",
    Icon: XCircle,
  },
} as const;

type SiteWithStatus = {
  site: Site;
  status: StatusSummary["status"] | null;
};

export function SiteListing() {
  const [sitesWithStatus, setSitesWithStatus] = useState<SiteWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const sitesResult = await getSites();
      if (!sitesResult.ok) {
        setError(sitesResult.error);
        setLoading(false);
        return;
      }

      const results = await Promise.all(
        sitesResult.data.map(async (site) => {
          const statusResult = await getStatus(site.id);
          return {
            site,
            status: statusResult.ok ? statusResult.data.status : null,
          };
        }),
      );

      setSitesWithStatus(results);
      setLoading(false);
    };
    void fetchData();
  }, []);

  if (loading) {
    return (
      <div className="text-center py-8">
        <span className="text-muted-foreground">Loading sites...</span>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="text-center py-8">
        <span className="text-muted-foreground">
          Unable to load status pages
        </span>
      </div>
    );
  }

  if (sitesWithStatus.length === 0) {
    return (
      <div className="text-center py-8">
        <span className="text-muted-foreground">
          No status pages configured yet.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sitesWithStatus.map(({ site, status }) => {
        const config = status === null ? null : statusConfig[status];
        const Icon = config?.Icon;

        return (
          <a
            key={site.id}
            href={`/${site.id}/`}
            className="block transition-transform hover:scale-[1.01]"
          >
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{site.name}</CardTitle>
                  {config !== null && Icon !== undefined ? (
                    <Badge
                      className={cn("border-transparent", config.className)}
                    >
                      <Icon className="h-3 w-3 mr-1" />
                      {config.label}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Unknown</Badge>
                  )}
                </div>
              </CardHeader>
              {site.url === null ? null : (
                <CardContent>
                  <p className="text-sm text-muted-foreground">{site.url}</p>
                </CardContent>
              )}
            </Card>
          </a>
        );
      })}
    </div>
  );
}
