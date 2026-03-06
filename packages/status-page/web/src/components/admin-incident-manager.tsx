import { useState } from "react";
import { createIncident, type Component, type Incident } from "#src/lib/api.ts";
import { Button } from "#src/components/ui/button.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { Textarea } from "#src/components/ui/textarea.tsx";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "#src/components/ui/select.tsx";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "#src/components/ui/card.tsx";
import { Separator } from "#src/components/ui/separator.tsx";
import { ActiveIncidentRow } from "#src/components/active-incident-row.tsx";

export function IncidentManager({
  apiKey,
  siteId,
  incidents,
  components,
  onRefresh,
  onMessage,
}: {
  apiKey: string;
  siteId: string;
  incidents: Incident[];
  components: Component[];
  onRefresh: () => Promise<void>;
  onMessage: (msg: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [impact, setImpact] = useState("minor");
  const [incidentMessage, setIncidentMessage] = useState("");
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);

  const handleCreate = async () => {
    if (title.trim() === "" || incidentMessage.trim() === "") return;
    const incidentData: {
      title: string;
      status: string;
      impact: string;
      message: string;
      componentIds?: string[];
    } = {
      title,
      status: "investigating",
      impact,
      message: incidentMessage,
    };
    if (selectedComponents.length > 0) {
      incidentData.componentIds = selectedComponents;
    }
    const result = await createIncident(apiKey, siteId, incidentData);
    if (result.ok) {
      setTitle("");
      setImpact("minor");
      setIncidentMessage("");
      setSelectedComponents([]);
      await onRefresh();
      onMessage("Incident created");
    } else {
      onMessage(`Error: ${result.error}`);
    }
  };

  const activeIncidents = incidents.filter((i) => i.status !== "resolved");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Incidents</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activeIncidents.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Active Incidents</p>
              {activeIncidents.map((incident) => (
                <ActiveIncidentRow
                  key={incident.id}
                  incident={incident}
                  apiKey={apiKey}
                  siteId={siteId}
                  onRefresh={onRefresh}
                  onMessage={onMessage}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active incidents.
            </p>
          )}

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">Create Incident</p>
            <Input
              placeholder="Title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
            <Select value={impact} onValueChange={setImpact}>
              <SelectTrigger>
                <SelectValue placeholder="Impact" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="minor">Minor</SelectItem>
                <SelectItem value="major">Major</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Initial update message"
              value={incidentMessage}
              onChange={(e) => {
                setIncidentMessage(e.target.value);
              }}
            />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Affected components:
              </p>
              {components.map((comp) => (
                <label
                  key={comp.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedComponents.includes(comp.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedComponents((prev) => [...prev, comp.id]);
                      } else {
                        setSelectedComponents((prev) =>
                          prev.filter((id) => id !== comp.id),
                        );
                      }
                    }}
                  />
                  {comp.name}
                </label>
              ))}
            </div>
            <Button
              onClick={() => {
                void handleCreate();
              }}
              size="sm"
            >
              Create Incident
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
