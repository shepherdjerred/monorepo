import { useState, useEffect } from "react";
import { Clock, FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useClauderonClient } from "../hooks/useClauderonClient";
import { DirectoryBrowserDialog } from "./DirectoryBrowserDialog";
import type { RecentRepoDto } from "@clauderon/client";

type RepositoryPathSelectorProps = {
  value: string;
  onChange: (path: string) => void;
  required?: boolean;
}

export function RepositoryPathSelector({ value, onChange, required }: RepositoryPathSelectorProps) {
  const client = useClauderonClient();
  const [recentRepos, setRecentRepos] = useState<RecentRepoDto[]>([]);
  const [isLoadingRecentRepos, setIsLoadingRecentRepos] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);

  // Fetch recent repos on mount
  useEffect(() => {
    const fetchRecentRepos = async () => {
      setIsLoadingRecentRepos(true);
      try {
        const repos = await client.getRecentRepos();
        setRecentRepos(repos);
      } catch (err) {
        console.error("Failed to fetch recent repos:", err);
      } finally {
        setIsLoadingRecentRepos(false);
      }
    };

    void fetchRecentRepos();
  }, [client]);

  const handleSelectRecentRepo = (path: string) => {
    onChange(path);
    setShowDropdown(false);
  };

  const handleOpenBrowser = () => {
    setShowDropdown(false);
    setShowBrowser(true);
  };

  const handleSelectFromBrowser = (path: string) => {
    onChange(path);
  };

  // Format relative time (simple version)
  const formatRelativeTime = (isoTimestamp: string): string => {
    const date = new Date(isoTimestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${String(diffMins)}m ago`;
    if (diffHours < 24) return `${String(diffHours)}h ago`;
    if (diffDays < 7) return `${String(diffDays)}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        {/* Input field */}
        <Input
          type="text"
          value={value}
          onChange={(e) => { onChange(e.target.value); }}
          className="border-2 flex-1"
          placeholder="/path/to/repo"
          required={required}
        />

        {/* Dropdown trigger button */}
        <button
          type="button"
          onClick={() => { setShowDropdown(!showDropdown); }}
          className="px-4 border-2 border-input bg-background hover:bg-primary/10 transition-all font-mono flex items-center gap-2"
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
            backgroundColor: 'hsl(220, 15%, 95%)',
            boxShadow: '8px 8px 0 hsl(220, 85%, 25%)'
          }}
        >
          {/* Recent Repos Section */}
          {recentRepos.length > 0 && (
            <div className="border-b-2 border-primary/20">
              <div className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground bg-primary/5">
                Recent:
              </div>
              <div className="max-h-64 overflow-y-auto">
                {recentRepos.map((repo) => (
                  <button
                    key={repo.repo_path}
                    type="button"
                    onClick={() => { handleSelectRecentRepo(repo.repo_path); }}
                    className="w-full text-left px-3 py-2 hover:bg-primary/10 border-b border-primary/10 font-mono text-sm flex items-center gap-2 transition-all"
                  >
                    <Clock className="w-4 h-4 flex-shrink-0 text-cyan-600" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{repo.repo_path}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatRelativeTime(repo.last_used)}
                      </div>
                    </div>
                  </button>
                ))}
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
            className="w-full text-left px-3 py-3 hover:bg-primary/10 font-mono text-sm flex items-center gap-2 transition-all border-t-2 border-primary/20"
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
          onClick={() => { setShowDropdown(false); }}
        />
      )}

      {/* Directory Browser Dialog */}
      {showBrowser && (
        <DirectoryBrowserDialog
          onClose={() => { setShowBrowser(false); }}
          onSelect={handleSelectFromBrowser}
          initialPath={value || "~"}
        />
      )}
    </div>
  );
}
