import { useState } from "react";
import type { CreateSessionRequest, BackendType, AgentType, AccessMode } from "@mux/client";
import { X } from "lucide-react";
import { useSessionContext } from "../contexts/SessionContext";

type CreateSessionDialogProps = {
  onClose: () => void;
}

export function CreateSessionDialog({ onClose }: CreateSessionDialogProps) {
  const { createSession } = useSessionContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
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
        name: formData.name,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-card rounded-lg max-w-2xl w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-2xl font-bold">Create New Session</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={(e) => { void handleSubmit(e); }} className="p-6 space-y-4">
          {error && (
            <div className="p-4 bg-destructive/10 text-destructive rounded-md">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">
              Session Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); }}
              className="w-full px-3 py-2 border rounded-md bg-background"
              placeholder="my-feature"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Repository Path
            </label>
            <input
              type="text"
              value={formData.repo_path}
              onChange={(e) => { setFormData({ ...formData, repo_path: e.target.value }); }}
              className="w-full px-3 py-2 border rounded-md bg-background"
              placeholder="/path/to/repo"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Initial Prompt
            </label>
            <textarea
              value={formData.initial_prompt}
              onChange={(e) =>
                { setFormData({ ...formData, initial_prompt: e.target.value }); }
              }
              className="w-full px-3 py-2 border rounded-md bg-background min-h-[100px]"
              placeholder="What should Claude Code do?"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Backend</label>
              <select
                value={formData.backend}
                onChange={(e) =>
                  { setFormData({ ...formData, backend: e.target.value as BackendType }); }
                }
                className="w-full px-3 py-2 border rounded-md bg-background"
              >
                <option value="Docker">Docker</option>
                <option value="Zellij">Zellij</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Access Mode</label>
              <select
                value={formData.access_mode}
                onChange={(e) =>
                  { setFormData({
                    ...formData,
                    access_mode: e.target.value as AccessMode,
                  }); }
                }
                className="w-full px-3 py-2 border rounded-md bg-background"
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
              className="w-4 h-4"
            />
            <label htmlFor="plan-mode" className="text-sm">
              Start in plan mode (read-only)
            </label>
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
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-md hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create Session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
