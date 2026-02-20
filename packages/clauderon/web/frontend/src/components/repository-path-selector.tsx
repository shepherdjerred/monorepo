import { useState } from "react";
import { Clock, FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DirectoryBrowserDialog } from "./directory-browser-dialog.tsx";
import type { RecentRepoDto } from "@clauderon/client";

type RepositoryPathSelectorProps = {
  value: string;
  onChange: (path: string) => void;
  required?: boolean;
};

// Extract repository name from full path
function extractRepoName(fullPath: string): string {
  const parts = fullPath.split("/");
  return parts.at(-1) ?? fullPath;
}

// Format relative time (simple version)
function formatRelativeTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return "just now";
  }
  if (diffMins < 60) {
    return `${String(diffMins)}m ago`;
  }
  if (diffHours < 24) {
    return `${String(diffHours)}h ago`;
  }
  if (diffDays < 7) {
    return `${String(diffDays)}d ago`;
  }
  return date.toLocaleDateString();
}

export function RepositoryPathSelector({
  value,
  onChange,
  required,
}: RepositoryPathSelectorProps) {
  const [recentRepos] = useState<RecentRepoDto[]>([]);
  const [isLoadingRecentRepos] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);

  // Fetch recent repos on mount
  // Format display with subdirectory
  const formatRepoDisplay = (repo: RecentRepoDto): string => {
    const repoName = extractRepoName(repo.repo_path);

    if (!repo.subdirectory || repo.subdirectory === "") {
      return repoName;
    }

    return `${repoName} › ${repo.subdirectory}`;
  };

  const handleSelectRecentRepo = (repo: RecentRepoDto) => {
    // Combine repo_path and subdirectory to get full path
    const fullPath =
      repo.subdirectory && repo.subdirectory !== ""
        ? `${repo.repo_path}/${repo.subdirectory}`
        : repo.repo_path;

    onChange(fullPath);
    setShowDropdown(false);
  };

  const handleOpenBrowser = () => {
    setShowDropdown(false);
    setShowBrowser(true);
  };

  const handleSelectFromBrowser = (path: string) => {
    onChange(path);
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        {/* Input field */}
        <Input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          className="border-2 flex-1"
          placeholder="/path/to/repo"
          required={required}
        />

        {/* Dropdown trigger button */}
        <button
          type="button"
          onClick={() => {
            setShowDropdown(!showDropdown);
          }}
          className="cursor-pointer px-4 border-2 border-input bg-background hover:bg-primary/10 hover:scale-105 transition-all duration-200 font-mono flex items-center gap-2"
          title="Show recent repositories and browse"
        >
          <FolderOpen className="w-4 h-4" />
          <span className="text-sm">▼</span>
        </button>
      </div>

      {/* Dropdown menu */}
      {showDropdown && (
        <div
          className="absolute z-10 mt-2 w-full border-4 border-primary overflow-hidden"
          style={{
            backgroundColor: "hsl(220, 15%, 95%)",
            boxShadow: "8px 8px 0 hsl(220, 85%, 25%)",
          }}
        >
          {/* Recent Repos Section */}
          {recentRepos.length > 0 && (
            <div className="border-b-2 border-primary/20">
              <div className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground bg-primary/5">
                Recent Repositories ({recentRepos.length}/20)
              </div>
              <div className="max-h-64 overflow-y-auto">
                {recentRepos.map((repo) => {
                  // Compute composite key using both repo_path and subdirectory
                  const key = `${repo.repo_path}::${repo.subdirectory}`;

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        handleSelectRecentRepo(repo);
                      }}
                      className="cursor-pointer w-full text-left px-3 py-2 hover:bg-primary/10 hover:pl-4 border-b border-primary/10 font-mono text-sm flex items-center gap-2 transition-all duration-200"
                    >
                      <Clock className="w-4 h-4 flex-shrink-0 text-cyan-600" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-semibold">
                          {formatRepoDisplay(repo)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatRelativeTime(repo.last_used)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Loading state */}
          {isLoadingRecentRepos && recentRepos.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center font-mono">
              Loading recent repositories...
            </div>
          )}

          {/* Empty state */}
          {!isLoadingRecentRepos && recentRepos.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center font-mono">
              No recent repositories
            </div>
          )}

          {/* Browse Section */}
          <button
            type="button"
            onClick={handleOpenBrowser}
            className="cursor-pointer w-full text-left px-3 py-3 hover:bg-primary/10 hover:pl-4 font-mono text-sm flex items-center gap-2 transition-all duration-200 border-t-2 border-primary/20"
          >
            <FolderOpen className="w-4 h-4 flex-shrink-0" />
            <span>Browse daemon filesystem...</span>
          </button>
        </div>
      )}

      {/* Close dropdown when clicking outside */}
      {showDropdown && (
        <div
          className="fixed inset-0 z-0"
          onPointerDown={() => {
            setShowDropdown(false);
          }}
        />
      )}

      {/* Directory Browser Dialog */}
      {showBrowser && (
        <DirectoryBrowserDialog
          onClose={() => {
            setShowBrowser(false);
          }}
          onSelect={handleSelectFromBrowser}
          initialPath={value || "~"}
        />
      )}
    </div>
  );
}
