import { useState } from "react";
import {
  updateIncident,
  addIncidentUpdate,
  type Incident,
  type Component,
} from "#src/lib/api.ts";
import { Button } from "#src/components/ui/button.tsx";
import { Textarea } from "#src/components/ui/textarea.tsx";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "#src/components/ui/select.tsx";
import { Badge } from "#src/components/ui/badge.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "#src/components/ui/dialog.tsx";
import { Separator } from "#src/components/ui/separator.tsx";
import { cn } from "#src/lib/utils.ts";

const statusColors: Record<Component["status"], string> = {
  operational: "bg-green-500 text-white",
  degraded: "bg-yellow-500 text-white",
  partial_outage: "bg-orange-500 text-white",
  major_outage: "bg-red-500 text-white",
};

const impactToStatusColor: Record<Incident["impact"], Component["status"]> = {
  critical: "major_outage",
  major: "partial_outage",
  minor: "degraded",
  none: "operational",
};

export function ActiveIncidentRow({
  incident,
  apiKey,
  siteId,
  onRefresh,
  onMessage,
}: {
  incident: Incident;
  apiKey: string;
  siteId: string;
  onRefresh: () => Promise<void>;
  onMessage: (msg: string) => void;
}) {
  const [updateMessage, setUpdateMessage] = useState("");
  const [updateStatus, setUpdateStatus] = useState(incident.status);
  const [newStatus, setNewStatus] = useState(incident.status);
  const [newImpact, setNewImpact] = useState(incident.impact);

  const handleAddUpdate = async () => {
    if (updateMessage.trim() === "") return;
    const result = await addIncidentUpdate(apiKey, siteId, incident.id, {
      status: updateStatus,
      message: updateMessage,
    });
    if (result.ok) {
      setUpdateMessage("");
      await onRefresh();
      onMessage("Update added");
    } else {
      onMessage(`Error: ${result.error}`);
    }
  };

  const handleUpdateIncident = async () => {
    const result = await updateIncident(apiKey, siteId, incident.id, {
      status: newStatus,
      impact: newImpact,
    });
    if (result.ok) {
      await onRefresh();
      onMessage("Incident updated");
    } else {
      onMessage(`Error: ${result.error}`);
    }
  };

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{incident.title}</span>
        <Badge
          className={cn(
            "border-transparent",
            statusColors[impactToStatusColor[incident.impact]],
          )}
        >
          {incident.impact}
        </Badge>
      </div>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            Manage
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{incident.title}</DialogTitle>
            <DialogDescription>
              Manage incident status and add updates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Select value={newStatus} onValueChange={(value: string) => setNewStatus(value as typeof newStatus)}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="investigating">Investigating</SelectItem>
                  <SelectItem value="identified">Identified</SelectItem>
                  <SelectItem value="monitoring">Monitoring</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
              <Select value={newImpact} onValueChange={(value: string) => setNewImpact(value as typeof newImpact)}>
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
              <Button
                onClick={() => {
                  void handleUpdateIncident();
                }}
                size="sm"
              >
                Update
              </Button>
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-sm font-medium">Add Update</p>
              <Select value={updateStatus} onValueChange={(value: string) => setUpdateStatus(value as typeof updateStatus)}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="investigating">Investigating</SelectItem>
                  <SelectItem value="identified">Identified</SelectItem>
                  <SelectItem value="monitoring">Monitoring</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                placeholder="Update message"
                value={updateMessage}
                onChange={(e) => {
                  setUpdateMessage(e.target.value);
                }}
              />
              <Button
                onClick={() => {
                  void handleAddUpdate();
                }}
                size="sm"
              >
                Add Update
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
