import { useState } from "react";
import type { CreateSessionRequest, BackendType, AgentType, AccessMode } from "@clauderon/client";
import { useSessionContext } from "../contexts/SessionContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CreateSessionDialogProps = {
  onClose: () => void;
}

export function CreateSessionDialog({ onClose }: CreateSessionDialogProps) {
  const { createSession } = useSessionContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    repo_path: "",
    initial_prompt: "",
    backend: "Docker" as BackendType,
    agent: "ClaudeCode" as AgentType,
    access_mode: "ReadWrite" as AccessMode,
    plan_mode: true,
    dangerous_skip_checks: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const request: CreateSessionRequest = {
        repo_path: formData.repo_path,
        initial_prompt: formData.initial_prompt,
        backend: formData.backend,
        agent: formData.agent,
        dangerous_skip_checks: formData.dangerous_skip_checks,
        print_mode: false,
        plan_mode: formData.plan_mode,
        access_mode: formData.access_mode,
        images: [],
      };

      await createSession(request);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) { onClose(); } }}>
      <DialogContent className="max-w-2xl border-4 border-primary">
        <DialogHeader>
          <DialogTitle className="text-2xl font-mono uppercase">
            Create New Session
          </DialogTitle>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-6">
          {error && (
            <div className="p-4 bg-destructive/10 text-destructive border-2 border-destructive rounded-md">
              <strong className="font-mono">Error:</strong> {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="repo_path" className="font-semibold">Repository Path</Label>
            <Input
              id="repo_path"
              type="text"
              value={formData.repo_path}
              onChange={(e) => { setFormData({ ...formData, repo_path: e.target.value }); }}
              className="border-2"
              placeholder="/path/to/repo"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="initial_prompt" className="font-semibold">Initial Prompt</Label>
            <textarea
              id="initial_prompt"
              value={formData.initial_prompt}
              onChange={(e) =>
                { setFormData({ ...formData, initial_prompt: e.target.value }); }
              }
              className="flex w-full rounded-md border-2 border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm min-h-[100px]"
              placeholder="What should Claude Code do?"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="backend" className="font-semibold">Backend</Label>
              <select
                id="backend"
                value={formData.backend}
                onChange={(e) =>
                  { setFormData({ ...formData, backend: e.target.value as BackendType }); }
                }
                className="flex h-10 w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="Docker">Docker</option>
                <option value="Zellij">Zellij</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="access_mode" className="font-semibold">Access Mode</Label>
              <select
                id="access_mode"
                value={formData.access_mode}
                onChange={(e) =>
                  { setFormData({
                    ...formData,
                    access_mode: e.target.value as AccessMode,
                  }); }
                }
                className="flex h-10 w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="ReadWrite">Read-Write</option>
                <option value="ReadOnly">Read-Only</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="plan-mode"
              checked={formData.plan_mode}
              onChange={(e) =>
                { setFormData({ ...formData, plan_mode: e.target.checked }); }
              }
              className="w-4 h-4 rounded border-2 border-input"
            />
            <Label htmlFor="plan-mode" className="cursor-pointer">
              Start in plan mode (read-only)
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="dangerous-skip-checks"
              checked={formData.dangerous_skip_checks}
              onChange={(e) =>
                { setFormData({ ...formData, dangerous_skip_checks: e.target.checked }); }
              }
              className="w-4 h-4"
            />
            <label htmlFor="dangerous-skip-checks" className="text-sm text-destructive font-medium">
              Dangerously skip safety checks (bypass permissions)
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="brutalist" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Session"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
