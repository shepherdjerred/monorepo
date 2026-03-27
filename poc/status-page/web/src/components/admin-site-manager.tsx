import { useState } from "react";
import { createSite, updateSite, deleteSite, type Site } from "#src/lib/api.ts";
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

export function SiteManager({
  apiKey,
  sites,
  selectedSiteId,
  onSelectSite,
  onRefresh,
  onMessage,
}: {
  apiKey: string;
  sites: Site[];
  selectedSiteId: string;
  onSelectSite: (id: string) => void;
  onRefresh: () => Promise<void>;
  onMessage: (msg: string) => void;
}) {
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");

  const handleCreate = async () => {
    if (newId.trim() === "" || newName.trim() === "") return;
    const data: { id: string; name: string; url?: string } = {
      id: newId,
      name: newName,
    };
    if (newUrl !== "") {
      data.url = newUrl;
    }
    const result = await createSite(apiKey, data);
    if (result.ok) {
      setNewId("");
      setNewName("");
      setNewUrl("");
      await onRefresh();
      onSelectSite(result.data.id);
      onMessage("Site created");
    } else {
      onMessage(`Error: ${result.error}`);
    }
  };

  const handleUpdate = async () => {
    if (editingSite === null || editName.trim() === "") return;
    const result = await updateSite(apiKey, editingSite.id, {
      name: editName,
      url: editUrl || null,
    });
    if (result.ok) {
      setEditingSite(null);
      await onRefresh();
      onMessage("Site updated");
    } else {
      onMessage(`Error: ${result.error}`);
    }
  };

  const handleDelete = async (siteId: string) => {
    const result = await deleteSite(apiKey, siteId);
    if (result.ok) {
      if (selectedSiteId === siteId) {
        onSelectSite("");
      }
      await onRefresh();
      onMessage("Site deleted");
    } else {
      onMessage(`Error: ${result.error}`);
    }
  };

  const startEdit = (site: Site) => {
    setEditingSite(site);
    setEditName(site.name);
    setEditUrl(site.url ?? "");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sites</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sites.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Select Site</p>
              <Select value={selectedSiteId} onValueChange={onSelectSite}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a site" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {sites.map((site) => (
            <div
              key={site.id}
              className="flex items-center justify-between rounded-md border p-3"
            >
              {editingSite?.id === site.id ? (
                <div className="flex-1 space-y-2 mr-2">
                  <Input
                    placeholder="Name"
                    value={editName}
                    onChange={(e) => {
                      setEditName(e.target.value);
                    }}
                  />
                  <Input
                    placeholder="URL (optional)"
                    value={editUrl}
                    onChange={(e) => {
                      setEditUrl(e.target.value);
                    }}
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        void handleUpdate();
                      }}
                      size="sm"
                    >
                      Save
                    </Button>
                    <Button
                      onClick={() => {
                        setEditingSite(null);
                      }}
                      variant="outline"
                      size="sm"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <p className="font-medium">{site.name}</p>
                    {site.url === null ? null : (
                      <p className="text-sm text-muted-foreground">
                        {site.url}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        startEdit(site);
                      }}
                      variant="outline"
                      size="sm"
                    >
                      Edit
                    </Button>
                    <Button
                      onClick={() => {
                        void handleDelete(site.id);
                      }}
                      variant="destructive"
                      size="sm"
                    >
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">Add Site</p>
            <Input
              placeholder="ID (slug, e.g. scout)"
              value={newId}
              onChange={(e) => {
                setNewId(e.target.value);
              }}
            />
            <Input
              placeholder="Name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
              }}
            />
            <Input
              placeholder="URL (optional)"
              value={newUrl}
              onChange={(e) => {
                setNewUrl(e.target.value);
              }}
            />
            <Button
              onClick={() => {
                void handleCreate();
              }}
              size="sm"
            >
              Add Site
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
