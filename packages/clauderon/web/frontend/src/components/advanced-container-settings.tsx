import type { StorageClassInfo, SessionModel } from "@clauderon/client";
import type { AgentType, AccessMode } from "@clauderon/shared";
import { BackendType } from "@clauderon/shared";
import { Label } from "@/components/ui/label";

export type SessionFormData = {
  initial_prompt: string;
  backend: BackendType;
  agent: AgentType;
  model: SessionModel | undefined;
  access_mode: AccessMode;
  plan_mode: boolean;
  dangerous_skip_checks: boolean;
  container_image: string;
  pull_policy: "always" | "if-not-present" | "never";
  cpu_limit: string;
  memory_limit: string;
  storage_class: string;
};

export function AdvancedContainerSettings({
  formData,
  setFormData,
  loadingStorageClasses,
  storageClasses,
}: {
  formData: SessionFormData;
  setFormData: React.Dispatch<React.SetStateAction<SessionFormData>>;
  loadingStorageClasses: boolean;
  storageClasses: StorageClassInfo[];
}) {
  return (
    <details
      className="space-y-2 border-2 border-primary p-4"
      style={{ backgroundColor: "hsl(220, 15%, 98%)" }}
    >
      <summary className="font-semibold cursor-pointer hover:text-primary font-mono uppercase tracking-wider mb-4">
        Advanced Container Settings
      </summary>

      <div className="pl-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="container_image">Custom Image (optional)</Label>
          <input
            type="text"
            id="container_image"
            placeholder="ghcr.io/user/image:tag"
            value={formData.container_image}
            onChange={(e) => {
              setFormData({
                ...formData,
                container_image: e.target.value,
              });
            }}
            className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Image must include:{" "}
            <code className="font-mono bg-muted px-1 py-0.5 rounded">
              claude
            </code>
            /
            <code className="font-mono bg-muted px-1 py-0.5 rounded">
              codex
            </code>{" "}
            CLI,{" "}
            <code className="font-mono bg-muted px-1 py-0.5 rounded">bash</code>
            ,{" "}
            <code className="font-mono bg-muted px-1 py-0.5 rounded">curl</code>
            ,{" "}
            <code className="font-mono bg-muted px-1 py-0.5 rounded">git</code>{" "}
            (recommended){" "}
            <a
              href="https://github.com/shepherdjerred/monorepo/blob/main/packages/clauderon/docs/IMAGE_COMPATIBILITY.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              View requirements
            </a>
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="pull_policy">Pull Policy</Label>
            <select
              id="pull_policy"
              value={formData.pull_policy}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "always" || val === "if-not-present" || val === "never") {
                  setFormData({ ...formData, pull_policy: val });
                }
              }}
              className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
            >
              <option value="if-not-present">If Not Present</option>
              <option value="always">Always</option>
              <option value="never">Never</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cpu_limit">CPU Limit</Label>
            <input
              type="text"
              id="cpu_limit"
              placeholder="2.0"
              value={formData.cpu_limit}
              onChange={(e) => {
                setFormData({ ...formData, cpu_limit: e.target.value });
              }}
              className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="memory_limit">Memory Limit</Label>
            <input
              type="text"
              id="memory_limit"
              placeholder="2g"
              value={formData.memory_limit}
              onChange={(e) => {
                setFormData({
                  ...formData,
                  memory_limit: e.target.value,
                });
              }}
              className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
            />
          </div>
        </div>

        {/* Storage Class (Kubernetes only) */}
        {formData.backend === BackendType.Kubernetes && (
          <div className="space-y-2">
            <Label htmlFor="storage_class">Storage Class (Kubernetes)</Label>
            {loadingStorageClasses ? (
              <div className="text-sm text-muted-foreground">
                Loading storage classes...
              </div>
            ) : (storageClasses.length > 0 ? (
              <>
                <select
                  id="storage_class"
                  value={formData.storage_class}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      storage_class: e.target.value,
                    });
                  }}
                  className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
                >
                  <option value="">Use default from config</option>
                  {storageClasses.map((sc) => (
                    <option key={sc.name} value={sc.name}>
                      {sc.name} {sc.is_default ? "(default)" : ""} -{" "}
                      {sc.provisioner}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Storage class for persistent volume claims (PVCs). Affects
                  cache and workspace volumes.
                </p>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                No storage classes available. Check cluster configuration.
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
