import { useState, useEffect } from "react";
import { Search, X, GitBranch } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useClauderonClient } from "../hooks/useClauderonClient";
import type { GitHubIssueDto } from "@clauderon/client";

type GitHubIssuePickerProps = {
  repoPath: string;
  value: number | undefined;
  onChange: (issueNumber: number | undefined) => void;
}

export function GitHubIssuePicker({ repoPath, value, onChange }: GitHubIssuePickerProps) {
  const client = useClauderonClient();
  const [issues, setIssues] = useState<GitHubIssueDto[]>([]);
  const [filteredIssues, setFilteredIssues] = useState<GitHubIssueDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Find selected issue
  const selectedIssue = issues.find(issue => issue.number === value);

  // Fetch issues when repoPath changes
  useEffect(() => {
    if (!repoPath) {
      setIssues([]);
      setFilteredIssues([]);
      return;
    }

    const fetchIssues = async () => {
      setIsLoading(true);
      setError(undefined);
      try {
        const fetchedIssues = await client.listGitHubIssues(repoPath, "open");
        setIssues(fetchedIssues);
        setFilteredIssues(fetchedIssues);
      } catch (err) {
        console.error("Failed to fetch GitHub issues:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch issues");
        setIssues([]);
        setFilteredIssues([]);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchIssues();
  }, [client, repoPath]);

  // Filter issues based on search query
  useEffect(() => {
    if (!searchQuery) {
      setFilteredIssues(issues);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = issues.filter(issue =>
      issue.title.toLowerCase().includes(query) ||
      issue.number.toString().includes(query) ||
      issue.labels.some(label => label.toLowerCase().includes(query))
    );
    setFilteredIssues(filtered);
  }, [searchQuery, issues]);

  const handleSelectIssue = (issue: GitHubIssueDto) => {
    onChange(issue.number);
    setShowDropdown(false);
    setSearchQuery("");
  };

  const handleClear = () => {
    onChange(undefined);
    setSearchQuery("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {selectedIssue ? (
          <div className="flex-1 flex items-center gap-2 p-2 border-2 rounded-md bg-muted">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">#{selectedIssue.number}</span>
            <span className="text-sm flex-1 truncate">{selectedIssue.title}</span>
            {selectedIssue.labels.length > 0 && (
              <div className="flex gap-1">
                {selectedIssue.labels.slice(0, 2).map(label => (
                  <Badge key={label} variant="secondary" className="text-xs">
                    {label}
                  </Badge>
                ))}
                {selectedIssue.labels.length > 2 && (
                  <Badge variant="secondary" className="text-xs">
                    +{selectedIssue.labels.length - 2}
                  </Badge>
                )}
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="h-6 w-6 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => { setShowDropdown(!showDropdown); }}
            disabled={!repoPath || isLoading}
            className="flex-1 justify-start"
          >
            <GitBranch className="h-4 w-4 mr-2" />
            {isLoading ? "Loading issues..." : "Select GitHub Issue"}
          </Button>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute z-10 w-full mt-1 border-2 rounded-md bg-background shadow-lg max-h-96 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); }}
                placeholder="Search issues..."
                className="pl-8"
              />
            </div>
          </div>

          {/* Issue list */}
          <div className="overflow-y-auto max-h-80">
            {filteredIssues.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {searchQuery ? "No matching issues" : "No open issues"}
              </div>
            ) : (
              <div className="divide-y">
                {filteredIssues.map(issue => (
                  <button
                    key={issue.number}
                    type="button"
                    onClick={() => { handleSelectIssue(issue); }}
                    className="w-full p-3 text-left hover:bg-muted transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm font-medium text-muted-foreground shrink-0">
                        #{issue.number}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{issue.title}</p>
                        {issue.body && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                            {issue.body}
                          </p>
                        )}
                        {issue.labels.length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {issue.labels.map(label => (
                              <Badge key={label} variant="outline" className="text-xs">
                                {label}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Close button */}
          <div className="p-2 border-t bg-muted/50">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setShowDropdown(false); }}
              className="w-full"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
