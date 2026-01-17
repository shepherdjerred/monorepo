import { useState, useEffect } from "react";
import type { CreateSessionRequest, BackendType, AccessMode } from "@clauderon/client";
import { AgentType } from "@clauderon/shared";
import { useSessionContext } from "../contexts/SessionContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import { RepositoryPathSelector } from "./RepositoryPathSelector";
import { ProviderIcon } from "./ProviderIcon";
import { toast } from "sonner";

type CreateSessionDialogProps = {
  onClose: () => void;
}

export function CreateSessionDialog({ onClose }: CreateSessionDialogProps) {
  const { createSession, client } = useSessionContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const [formData, setFormData] = useState({
    repo_path: "",
    initial_prompt: "",
    backend: "Docker" as BackendType,
    agent: AgentType.ClaudeCode,
    access_mode: "ReadWrite" as AccessMode,
    plan_mode: true,
    dangerous_skip_checks: true, // Docker/Kubernetes default
    // Advanced container settings
    container_image: "",
    pull_policy: "if-not-present" as "always" | "if-not-present" | "never",
    cpu_limit: "",
    memory_limit: "",
  });

  // Auto-check dangerous_skip_checks for Docker and Kubernetes, uncheck for Zellij
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      dangerous_skip_checks: prev.backend === "Docker" || prev.backend === "Kubernetes"
    }));
  }, [formData.backend]);

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
        // Include container settings if specified
        pull_policy: formData.pull_policy,
        ...(formData.container_image && { container_image: formData.container_image }),
        ...(formData.cpu_limit && { cpu_limit: formData.cpu_limit }),
        ...(formData.memory_limit && { memory_limit: formData.memory_limit }),
      };

      const result = await createSession(request);

      // Upload images if any were selected
      if (selectedFiles.length > 0 && result) {
        toast.info(`Uploading ${selectedFiles.length} image(s)...`);
        for (const file of selectedFiles) {
          try {
            await client.uploadImage(result, file);
          } catch (uploadErr) {
            console.error('Failed to upload image:', uploadErr);
            toast.warning(`Failed to upload ${file.name}`);
          }
        }
      }

      toast.success("Session created successfully");
      onClose();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      toast.error(`Failed to create session: ${errorMsg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => { document.removeEventListener('keydown', handleEscape); };
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: 'hsl(220, 90%, 8%)',
          opacity: 0.85
        }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-8 z-50">
        <div
          className="max-w-2xl w-full flex flex-col border-4 border-primary max-h-[90vh]"
          style={{
            backgroundColor: 'hsl(220, 15%, 95%)',
            boxShadow: '12px 12px 0 hsl(220, 85%, 25%), 24px 24px 0 hsl(220, 90%, 10%)'
          }}
          onClick={(e) => { e.stopPropagation(); }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b-4 border-primary" style={{ backgroundColor: 'hsl(220, 85%, 25%)' }}>
            <h2 className="text-2xl font-bold font-mono uppercase tracking-wider text-white">
              Create New Session
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

        {/* Form */}
        <form onSubmit={(e) => { void handleSubmit(e); }} className="p-6 space-y-6 overflow-y-auto" style={{ backgroundColor: 'hsl(220, 15%, 95%)' }}>
          {error && (
            <div className="p-4 border-4 font-mono" style={{ backgroundColor: 'hsl(0, 75%, 95%)', color: 'hsl(0, 75%, 40%)', borderColor: 'hsl(0, 75%, 50%)' }}>
              <strong className="font-bold">ERROR:</strong> {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="repo_path" className="font-semibold">Repository Path</Label>
            <RepositoryPathSelector
              value={formData.repo_path}
              onChange={(path) => { setFormData({ ...formData, repo_path: path }); }}
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
              placeholder={formData.agent === "Codex" ? "What should Codex do?" : "What should Claude Code do?"}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="backend" className="font-semibold">Backend</Label>
              <select
                id="backend"
                value={formData.backend}
                onChange={(e) =>
                  { setFormData({ ...formData, backend: e.target.value as BackendType }); }
                }
                className="cursor-pointer flex h-10 w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="Docker">Docker</option>
                <option value="Zellij">Zellij</option>
                <option value="Kubernetes">Kubernetes</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent" className="font-semibold">Agent</Label>
              <Select
                value={formData.agent}
                onValueChange={(value) => {
                  setFormData({ ...formData, agent: value as AgentType });
                }}
              >
                <SelectTrigger className="border-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AgentType.ClaudeCode}>
                    <div className="flex items-center gap-2">
                      <ProviderIcon agent={AgentType.ClaudeCode} />
                      <span>Claude Code</span>
                    </div>
                  </SelectItem>
                  <SelectItem value={AgentType.Codex}>
                    <div className="flex items-center gap-2">
                      <ProviderIcon agent={AgentType.Codex} />
                      <span>Codex</span>
                    </div>
                  </SelectItem>
                  <SelectItem value={AgentType.Gemini}>
                    <div className="flex items-center gap-2">
                      <ProviderIcon agent={AgentType.Gemini} />
                      <span>Gemini</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
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
                className="cursor-pointer flex h-10 w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="ReadWrite">Read-Write</option>
                <option value="ReadOnly">Read-Only</option>
              </select>
            </div>
          </div>

          {formData.backend === "Kubernetes" && (
            <div className="mt-2 p-3 border-2 text-sm font-mono" style={{
              backgroundColor: 'hsl(220, 15%, 90%)',
              borderColor: 'hsl(220, 85%, 65%)',
              color: 'hsl(220, 85%, 25%)'
            }}>
              <strong>Note:</strong> Requires kubectl access and the <code>clauderon</code> namespace.
              Configuration: <code>~/.clauderon/k8s-config.toml</code>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="images">Attach Images (optional)</Label>
            <input
              type="file"
              id="images"
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
              multiple
              onChange={(e) => {
                if (e.target.files) {
                  setSelectedFiles(Array.from(e.target.files));
                }
              }}
              className="block w-full text-sm border-2 rounded file:mr-4 file:py-2 file:px-4 file:border-0 file:font-semibold"
            />
            {selectedFiles.length > 0 && (
              <div className="space-y-1 mt-2">
                {selectedFiles.map((file, i) => (
                  <div key={i} className="flex items-center justify-between p-2 border-2 rounded bg-white">
                    <span className="text-sm truncate font-mono">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedFiles(files => files.filter((_, idx) => idx !== i))}
                      className="text-red-600 font-bold px-2 hover:bg-red-100 rounded"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Advanced Container Settings */}
          <details className="space-y-2 border-2 border-primary p-4" style={{ backgroundColor: 'hsl(220, 15%, 98%)' }}>
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
                  onChange={(e) => setFormData({ ...formData, container_image: e.target.value })}
                  className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Image must include: <code className="font-mono bg-muted px-1 py-0.5 rounded">claude</code>/<code className="font-mono bg-muted px-1 py-0.5 rounded">codex</code> CLI, <code className="font-mono bg-muted px-1 py-0.5 rounded">bash</code>, <code className="font-mono bg-muted px-1 py-0.5 rounded">curl</code>, <code className="font-mono bg-muted px-1 py-0.5 rounded">git</code> (recommended)
                  {' '}<a href="https://github.com/shepherdjerred/monorepo/blob/main/packages/clauderon/docs/IMAGE_COMPATIBILITY.md" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View requirements</a>
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pull_policy">Pull Policy</Label>
                  <select
                    id="pull_policy"
                    value={formData.pull_policy}
                    onChange={(e) => setFormData({ ...formData, pull_policy: e.target.value as "always" | "if-not-present" | "never" })}
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
                    onChange={(e) => setFormData({ ...formData, cpu_limit: e.target.value })}
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
                    onChange={(e) => setFormData({ ...formData, memory_limit: e.target.value })}
                    className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
                  />
                </div>
              </div>
            </div>
          </details>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="plan-mode"
              checked={formData.plan_mode}
              onChange={(e) =>
                { setFormData({ ...formData, plan_mode: e.target.checked }); }
              }
              className="cursor-pointer w-4 h-4 rounded border-2 border-input"
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
              className="cursor-pointer w-4 h-4"
            />
            <label htmlFor="dangerous-skip-checks" className="cursor-pointer text-sm text-destructive font-medium">
              Dangerously skip safety checks (bypass permissions)
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t-4 border-primary">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="brutalist" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Session"}
            </Button>
          </div>
        </form>
        </div>
      </div>
    </>
  );
}
