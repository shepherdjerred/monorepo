import { useState, useEffect } from "react";
import { getSites, type Site } from "#src/lib/api.ts";
import { StatusOverview } from "#src/components/status-overview.tsx";
import { ComponentList } from "#src/components/component-list.tsx";
import { IncidentTimeline } from "#src/components/incident-timeline.tsx";
import { UptimeChart } from "#src/components/uptime-chart.tsx";

export function SiteStatusPage() {
  const [siteId, setSiteId] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const path = globalThis.location.pathname.replaceAll(/^\/+|\/+$/g, "");
    if (path === "" || path === "admin") return;

    setSiteId(path);

    const fetchSiteName = async () => {
      const result = await getSites();
      if (result.ok) {
        const site = result.data.find((s: Site) => s.id === path);
        if (site) {
          setSiteName(site.name);
        } else {
          setNotFound(true);
        }
      }
    };
    void fetchSiteName();
  }, []);

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 space-y-8">
        <header className="text-center">
          <h1 className="text-3xl font-bold">Site Not Found</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            <a href="/" className="hover:underline">
              View all status pages
            </a>
          </p>
        </header>
      </main>
    );
  }

  if (siteId === null) {
    return null;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-8">
      <header className="text-center">
        <h1 className="text-3xl font-bold">{siteName ?? siteId} Status</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          <a href="/" className="hover:underline">
            All status pages
          </a>
        </p>
      </header>

      <StatusOverview siteId={siteId} />
      <ComponentList siteId={siteId} />
      <UptimeChart siteId={siteId} />
      <IncidentTimeline siteId={siteId} />

      <footer className="text-center text-xs text-gray-500 dark:text-gray-400 py-4">
        <a href="/admin" className="hover:underline">
          Admin
        </a>
      </footer>
    </main>
  );
}
