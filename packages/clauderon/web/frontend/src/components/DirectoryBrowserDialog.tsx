import { useState, useEffect } from "react";
import { X, Folder, FolderOpen, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClauderonClient } from "../hooks/useClauderonClient";
import type { DirectoryEntryDto } from "@clauderon/client";

type DirectoryBrowserDialogProps = {
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
};

export function DirectoryBrowserDialog({
  onClose,
  onSelect,
  initialPath,
}: DirectoryBrowserDialogProps) {
  const client = useClauderonClient();
  const [currentPath, setCurrentPath] = useState(initialPath ?? "~");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntryDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch directory contents
  useEffect(() => {
    const fetchDirectory = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await client.browseDirectory(currentPath);

        if (response.error) {
          setError(response.error);
          // Don't update entries if there's an error
        } else {
          setCurrentPath(response.current_path);
          setParentPath(response.parent_path ?? null);
          setEntries(response.entries);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    };

    void fetchDirectory();
  }, [currentPath, client]);

  const handleNavigateToParent = () => {
    if (parentPath) {
      setCurrentPath(parentPath);
    }
  };

  const handleNavigateToDirectory = (path: string) => {
    setCurrentPath(path);
  };

  const handleSelectCurrent = () => {
    onSelect(currentPath);
    onClose();
  };

  const handleGoHome = () => {
    setCurrentPath("~");
  };

  // Render breadcrumb from path
  const renderBreadcrumb = () => {
    const segments = currentPath.split("/").filter(Boolean);

    return (
      <div className="flex items-center gap-1 text-sm font-mono overflow-x-auto">
        <button
          onClick={() => {
            setCurrentPath("/");
          }}
          className="cursor-pointer px-2 py-1 hover:bg-primary/10 rounded transition-all duration-200"
        >
          /
        </button>
        {segments.map((segment, index) => {
          const path = "/" + segments.slice(0, index + 1).join("/");
          return (
            <div key={path} className="flex items-center gap-1">
              <span className="text-muted-foreground">/</span>
              <button
                onClick={() => {
                  setCurrentPath(path);
                }}
                className="cursor-pointer px-2 py-1 hover:bg-primary/10 rounded transition-all duration-200"
              >
                {segment}
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: "hsl(220, 90%, 8%)",
          opacity: 0.85,
        }}
      />

      {/* Dialog */}
      <div className="fixed inset-0 flex items-center justify-center p-8 z-50">
        <div
          className="max-w-3xl w-full flex flex-col border-4 border-primary max-h-[80vh]"
          style={{
            backgroundColor: "hsl(220, 15%, 95%)",
            boxShadow:
              "12px 12px 0 hsl(220, 85%, 25%), 24px 24px 0 hsl(220, 90%, 10%)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between p-4 border-b-4 border-primary"
            style={{ backgroundColor: "hsl(220, 85%, 25%)" }}
          >
            <h2 className="text-2xl font-bold font-mono uppercase tracking-wider text-white">
              Browse Filesystem
            </h2>
            <button
              onClick={onClose}
              className="cursor-pointer p-2 border-2 border-white bg-white/10 hover:bg-red-600 hover:text-white transition-all duration-200 font-bold text-white"
              title="Close dialog"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Breadcrumb & Actions */}
          <div
            className="p-4 border-b-2 border-primary/20 flex items-center justify-between gap-4"
            style={{ backgroundColor: "hsl(220, 15%, 90%)" }}
          >
            <div className="flex-1 min-w-0">{renderBreadcrumb()}</div>
            <button
              onClick={handleGoHome}
              className="cursor-pointer p-2 border-2 border-primary hover:bg-primary/10 transition-all duration-200 hover:scale-105"
              title="Go to home directory"
              aria-label="Go to home directory"
            >
              <Home className="w-4 h-4" />
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div
              className="m-4 p-4 border-4 font-mono"
              style={{
                backgroundColor: "hsl(0, 75%, 95%)",
                color: "hsl(0, 75%, 40%)",
                borderColor: "hsl(0, 75%, 50%)",
              }}
            >
              <strong className="font-bold">ERROR:</strong> {error}
            </div>
          )}

          {/* Directory List */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground font-mono">
                Loading...
              </div>
            ) : (
              <div className="space-y-1">
                {/* Parent Directory */}
                {parentPath && (
                  <button
                    onClick={handleNavigateToParent}
                    className="cursor-pointer w-full text-left p-3 border-2 border-primary/30 hover:bg-primary/10 hover:border-primary hover:pl-4 transition-all duration-200 font-mono flex items-center gap-2"
                  >
                    <FolderOpen className="w-5 h-5 flex-shrink-0" />
                    <span>..</span>
                  </button>
                )}

                {/* Subdirectories */}
                {entries.length === 0 && !error ? (
                  <div className="text-center py-8 text-muted-foreground font-mono">
                    No subdirectories found
                  </div>
                ) : (
                  entries.map((entry) => (
                    <button
                      key={entry.path}
                      onClick={() => {
                        if (entry.is_accessible) {
                          handleNavigateToDirectory(entry.path);
                        }
                      }}
                      disabled={!entry.is_accessible}
                      className={`w-full text-left p-3 border-2 font-mono flex items-center gap-2 transition-all duration-200 ${
                        entry.is_accessible
                          ? "cursor-pointer border-primary/30 hover:bg-primary/10 hover:border-primary hover:pl-4"
                          : "border-muted/30 opacity-50 cursor-not-allowed"
                      }`}
                      title={
                        entry.is_accessible
                          ? `Open ${entry.name}`
                          : `Cannot access ${entry.name}`
                      }
                    >
                      <Folder className="w-5 h-5 flex-shrink-0" />
                      <span className="truncate">{entry.name}</span>
                      {!entry.is_accessible && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          (no access)
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div
            className="flex justify-end gap-3 p-4 border-t-4 border-primary"
            style={{ backgroundColor: "hsl(220, 15%, 90%)" }}
          >
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="brutalist"
              onClick={handleSelectCurrent}
              disabled={isLoading || Boolean(error)}
              className="cursor-pointer"
            >
              Select Directory
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
