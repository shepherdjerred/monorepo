import { useState, useEffect, useCallback } from "react";
import {
  getSites,
  getComponents,
  getIncidents,
  type Site,
  type Component,
  type Incident,
} from "#src/lib/api.ts";
import { Input } from "#src/components/ui/input.tsx";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "#src/components/ui/card.tsx";
import { Separator } from "#src/components/ui/separator.tsx";
import { SiteManager } from "#src/components/admin-site-manager.tsx";
import { ComponentManager } from "#src/components/admin-component-manager.tsx";
import { IncidentManager } from "#src/components/admin-incident-manager.tsx";

export function AdminPanel() {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem("status-api-key") ?? "",
  );
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [components, setComponents] = useState<Component[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem("status-api-key", key);
  };

  const refreshSites = useCallback(async () => {
    const result = await getSites();
    if (result.ok) {
      setSites(result.data);
      const first = result.data[0];
      if (first !== undefined && selectedSiteId === "") {
        setSelectedSiteId(first.id);
      }
    }
  }, [selectedSiteId]);

  const refreshSiteData = useCallback(async () => {
    if (selectedSiteId === "") return;
    const [compResult, incResult] = await Promise.all([
      getComponents(selectedSiteId),
      getIncidents(selectedSiteId),
    ]);
    if (compResult.ok) setComponents(compResult.data);
    if (incResult.ok) setIncidents(incResult.data);
  }, [selectedSiteId]);

  useEffect(() => {
    void refreshSites();
  }, [refreshSites]);

  useEffect(() => {
    void refreshSiteData();
  }, [refreshSiteData]);

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => {
      setMessage(null);
    }, 3000);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="API Key"
              value={apiKey}
              onChange={(e) => {
                saveApiKey(e.target.value);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {message === null ? null : (
        <div className="rounded-md bg-green-100 p-3 text-sm text-green-800 dark:bg-green-900 dark:text-green-200">
          {message}
        </div>
      )}

      <SiteManager
        apiKey={apiKey}
        sites={sites}
        selectedSiteId={selectedSiteId}
        onSelectSite={setSelectedSiteId}
        onRefresh={refreshSites}
        onMessage={showMessage}
      />

      {selectedSiteId === "" ? null : (
        <>
          <Separator />

          <ComponentManager
            apiKey={apiKey}
            siteId={selectedSiteId}
            components={components}
            onRefresh={refreshSiteData}
            onMessage={showMessage}
          />

          <Separator />

          <IncidentManager
            apiKey={apiKey}
            siteId={selectedSiteId}
            incidents={incidents}
            components={components}
            onRefresh={refreshSiteData}
            onMessage={showMessage}
          />
        </>
      )}
    </div>
  );
}
