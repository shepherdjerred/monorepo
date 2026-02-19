import { Label } from "@/components/ui/label";
import { Trash2, Star } from "lucide-react";
import { RepositoryPathSelector } from "./repository-path-selector.tsx";

type RepositoryEntry = {
  id: string;
  repo_path: string;
  mount_name: string;
  is_primary: boolean;
  base_branch: string;
};

type RepositoryEntryFormProps = {
  repo: RepositoryEntry;
  index: number;
  multiRepoEnabled: boolean;
  repositoriesCount: number;
  onPathChange: (id: string, path: string) => void;
  onBaseBranchChange: (id: string, branch: string) => void;
  onMountNameChange: (id: string, name: string) => void;
  onSetPrimary: (id: string) => void;
  onRemove: (id: string) => void;
};

export function RepositoryEntryForm({
  repo,
  index,
  multiRepoEnabled,
  repositoriesCount,
  onPathChange,
  onBaseBranchChange,
  onMountNameChange,
  onSetPrimary,
  onRemove,
}: RepositoryEntryFormProps) {
  return (
    <div
      className="border-2 border-primary p-3 space-y-2"
      style={{ backgroundColor: "hsl(220, 15%, 98%)" }}
    >
      {multiRepoEnabled && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">
              #{index + 1}
            </span>
            {repo.is_primary && (
              <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-bold border-2 border-yellow-600 bg-yellow-100 text-yellow-800">
                <Star className="w-3 h-3 fill-yellow-600" />
                PRIMARY
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!repo.is_primary && (
              <button
                type="button"
                onClick={() => {
                  onSetPrimary(repo.id);
                }}
                className="text-xs px-2 py-1 border-2 hover:bg-yellow-100 hover:border-yellow-600"
                title="Set as primary repository"
              >
                Set Primary
              </button>
            )}
            {repositoriesCount > 2 && (
              <button
                type="button"
                onClick={() => {
                  onRemove(repo.id);
                }}
                className="p-1 border-2 hover:bg-red-100 hover:border-red-600 text-red-600"
                title="Remove repository"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={`repo-path-${repo.id}`} className="text-sm">
          Repository Path
        </Label>
        <RepositoryPathSelector
          value={repo.repo_path}
          onChange={(path) => {
            onPathChange(repo.id, path);
          }}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`base-branch-${repo.id}`} className="text-sm">
          Base Branch{" "}
          <span className="text-xs text-muted-foreground">
            (optional, for Sprites/K8s)
          </span>
        </Label>
        <input
          type="text"
          id={`base-branch-${repo.id}`}
          value={repo.base_branch}
          onChange={(e) => {
            onBaseBranchChange(repo.id, e.target.value);
          }}
          placeholder="main (default)"
          className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
          maxLength={128}
        />
        <p className="text-xs text-muted-foreground">
          Branch to clone from for clone-based backends (Sprites, Kubernetes).
          Leave empty for default branch.
        </p>
      </div>

      {multiRepoEnabled && (
        <div className="space-y-2">
          <Label htmlFor={`mount-name-${repo.id}`} className="text-sm">
            Mount Name{" "}
            <span className="text-xs text-muted-foreground">
              (alphanumeric + hyphens/underscores)
            </span>
          </Label>
          <input
            type="text"
            id={`mount-name-${repo.id}`}
            value={repo.mount_name}
            onChange={(e) => {
              onMountNameChange(repo.id, e.target.value);
            }}
            placeholder="auto-generated"
            className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
            pattern="[a-z0-9][a-z0-9-_]{0,62}[a-z0-9]"
            maxLength={64}
            required
          />
          <p className="text-xs text-muted-foreground">
            Container path:{" "}
            {repo.is_primary
              ? "/workspace"
              : `/repos/${repo.mount_name || "..."}`}
          </p>
        </div>
      )}
    </div>
  );
}
