import { useState } from "react";
import {
  updateComponent,
  createComponent,
  type Component,
} from "#src/lib/api.ts";
import { Button } from "#src/components/ui/button.tsx";
import { Input } from "#src/components/ui/input.tsx";
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

export function ComponentManager({
  apiKey,
  siteId,
  components,
  onRefresh,
  onMessage,
}: {
  apiKey: string;
  siteId: string;
  components: Component[];
  onRefresh: () => Promise<void>;
  onMessage: (msg: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const handleCreate = async () => {
    if (newName.trim() === "") return;
    const data: { name: string; description?: string } = { name: newName };
    if (newDesc !== "") {
      data.description = newDesc;
    }
    const result = await createComponent(apiKey, siteId, data);
    if (result.ok) {
      setNewName("");
      setNewDesc("");
      await onRefresh();
      onMessage("Component created");
    } else {
      onMessage(`Error: ${result.error}`);
    }
  };

  const handleStatusChange = async (componentId: string, status: string) => {
    const result = await updateComponent(apiKey, siteId, componentId, {
      status,
    });
    if (result.ok) {
      await onRefresh();
      onMessage("Component status updated");
    } else {
      onMessage(`Error: ${result.error}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Components</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {components.map((comp) => (
            <div
              key={comp.id}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <div>
                <p className="font-medium">{comp.name}</p>
                {comp.description === null ? null : (
                  <p className="text-sm text-muted-foreground">
                    {comp.description}
                  </p>
                )}
              </div>
              <Select
                value={comp.status}
                onValueChange={(value) => {
                  void handleStatusChange(comp.id, value);
                }}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operational">Operational</SelectItem>
                  <SelectItem value="degraded">Degraded</SelectItem>
                  <SelectItem value="partial_outage">Partial Outage</SelectItem>
                  <SelectItem value="major_outage">Major Outage</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">Add Component</p>
            <Input
              placeholder="Name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
              }}
            />
            <Input
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => {
                setNewDesc(e.target.value);
              }}
            />
            <Button
              onClick={() => {
                void handleCreate();
              }}
              size="sm"
            >
              Add Component
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
