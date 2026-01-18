import { useState, useEffect, useMemo } from "react";
import type { CreateSessionRequest, BackendType, AccessMode, StorageClassInfo, CreateRepositoryInput, SessionModel, ClaudeModel, CodexModel, GeminiModel } from "@clauderon/client";
import { AgentType, type FeatureFlags } from "@clauderon/shared";
import { useSessionContext } from "../contexts/SessionContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Check, AlertCircle, Plus, Trash2, Star } from "lucide-react";
import { RepositoryPathSelector } from "./RepositoryPathSelector";
import { ProviderIcon } from "./ProviderIcon";
import { toast } from "sonner";
import { AGENT_CAPABILITIES } from "@/lib/agent-features";

type CreateSessionDialogProps = {
  onClose: () => void;
}

type RepositoryEntry = {
  id: string;
  repo_path: string;
  mount_name: string;
  is_primary: boolean;
  base_branch: string;
};

export function CreateSessionDialog({ onClose }: CreateSessionDialogProps) {
  const { createSession, client } = useSessionContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);
  const [storageClasses, setStorageClasses] = useState<StorageClassInfo[]>([]);
  const [loadingStorageClasses, setLoadingStorageClasses] = useState(false);

  // Multi-repo state
  const [multiRepoEnabled, setMultiRepoEnabled] = useState(false);
  const [repositories, setRepositories] = useState<RepositoryEntry[]>([
    { id: '1', repo_path: '', mount_name: '', is_primary: true, base_branch: '' }
  ]);

  const [formData, setFormData] = useState({
    initial_prompt: "",
    backend: "Docker" as BackendType,
    agent: AgentType.ClaudeCode,
    model: undefined as SessionModel | undefined,
    access_mode: "ReadWrite" as AccessMode,
    plan_mode: true,
    dangerous_skip_checks: true, // Docker/Kubernetes default
    // Advanced container settings
    container_image: "",
    pull_policy: "if-not-present" as "always" | "if-not-present" | "never",
    cpu_limit: "",
    memory_limit: "",
    storage_class: "",
  });

  // Auto-check dangerous_skip_checks for Docker, Kubernetes, and Sprites, uncheck for Zellij
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      dangerous_skip_checks: (prev.backend as string) === "Docker" || (prev.backend as string) === "Kubernetes" || (prev.backend as string) === "Sprites"
    }));
  }, [formData.backend]);

  // Fetch storage classes when Kubernetes backend is selected
  useEffect(() => {
    if ((formData.backend as string) === "Kubernetes") {
      setLoadingStorageClasses(true);
      client.getStorageClasses()
        .then((classes) => {
          setStorageClasses(classes);
          // Auto-select default storage class if available
          const defaultClass = classes.find(c => c.is_default);
          if (defaultClass && !formData.storage_class) {
            setFormData(prev => ({ ...prev, storage_class: defaultClass.name }));
          }
        })
        .catch((err: unknown) => {
          console.error('Failed to fetch storage classes:', err);
          toast.warning('Could not load storage classes from cluster');
          setStorageClasses([]);
        })
        .finally(() => {
          setLoadingStorageClasses(false);
        });
    } else {
      // Clear storage classes when switching away from Kubernetes
      setStorageClasses([]);
      setFormData(prev => ({ ...prev, storage_class: "" }));
    }
  }, [formData.backend, formData.storage_class, client]);

  // Reset model when agent changes
  useEffect(() => {
    setFormData(prev => ({ ...prev, model: undefined }));
  }, [formData.agent]);

  // Fetch feature flags on mount
  useEffect(() => {
    const fetchFlags = async () => {
      try {
        const response = await fetch('/api/feature-flags');
        const data: { flags: FeatureFlags } = await response.json() as { flags: FeatureFlags };
        setFeatureFlags(data.flags);
      } catch (error) {
        console.error('Failed to fetch feature flags:', error);
      }
    };
    void fetchFlags();
  }, []);

  // Reset backend if Kubernetes is disabled
  useEffect(() => {
    if ((formData.backend as string) === "Kubernetes" && featureFlags && !featureFlags.enable_kubernetes_backend) {
      setFormData(prev => ({ ...prev, backend: "Docker" as BackendType }));
    }
  }, [featureFlags, formData.backend]);

  // Sync repositories array with multi-repo toggle
  useEffect(() => {
    if (multiRepoEnabled) {
      // When enabled: Ensure at least 2 repos (add empty second repo if needed)
      setRepositories(prev => prev.length === 1
        ? [...prev, { id: String(Date.now()), repo_path: '', mount_name: '', is_primary: false, base_branch: '' }]
        : prev
      );
    } else {
      // When disabled: Keep only first repo, discard others immediately
      setRepositories(prev => {
        if (prev.length > 1 && prev[0]) {
          return [prev[0]];
        }
        return prev;
      });
    }
  }, [multiRepoEnabled]);

  // Compute available models based on selected agent
  const availableModels = useMemo(() => {
    switch (formData.agent) {
      case AgentType.ClaudeCode:
        return [
          { value: { type: "Claude" as const, content: "Sonnet4_5" as ClaudeModel }, label: "Sonnet 4.5 (Default - Balanced)" },
          { value: { type: "Claude" as const, content: "Opus4_5" as ClaudeModel }, label: "Opus 4.5 (Most Capable)" },
          { value: { type: "Claude" as const, content: "Haiku4_5" as ClaudeModel }, label: "Haiku 4.5 (Fastest)" },
          { value: { type: "Claude" as const, content: "Opus4_1" as ClaudeModel }, label: "Opus 4.1 (Agentic)" },
          { value: { type: "Claude" as const, content: "Opus4" as ClaudeModel }, label: "Opus 4" },
          { value: { type: "Claude" as const, content: "Sonnet4" as ClaudeModel }, label: "Sonnet 4" },
        ];
      case AgentType.Codex:
        return [
          { value: { type: "Codex" as const, content: "Gpt5_2Codex" as CodexModel }, label: "GPT-5.2-Codex (Default - Best for Code)" },
          { value: { type: "Codex" as const, content: "Gpt5_2" as CodexModel }, label: "GPT-5.2" },
          { value: { type: "Codex" as const, content: "Gpt5_2Instant" as CodexModel }, label: "GPT-5.2 Instant (Fast)" },
          { value: { type: "Codex" as const, content: "Gpt5_2Thinking" as CodexModel }, label: "GPT-5.2 Thinking (Reasoning)" },
          { value: { type: "Codex" as const, content: "Gpt5_2Pro" as CodexModel }, label: "GPT-5.2 Pro (Premium)" },
          { value: { type: "Codex" as const, content: "Gpt5_1" as CodexModel }, label: "GPT-5.1" },
          { value: { type: "Codex" as const, content: "Gpt5_1Instant" as CodexModel }, label: "GPT-5.1 Instant" },
          { value: { type: "Codex" as const, content: "Gpt5_1Thinking" as CodexModel }, label: "GPT-5.1 Thinking" },
          { value: { type: "Codex" as const, content: "Gpt4_1" as CodexModel }, label: "GPT-4.1 (Coding Specialist)" },
          { value: { type: "Codex" as const, content: "O3Mini" as CodexModel }, label: "o3-mini (Small Reasoning)" },
        ];
      case AgentType.Gemini:
        return [
          { value: { type: "Gemini" as const, content: "Gemini3Pro" as GeminiModel }, label: "Gemini 3 Pro (Default - 1M Context)" },
          { value: { type: "Gemini" as const, content: "Gemini3Flash" as GeminiModel }, label: "Gemini 3 Flash (Fast)" },
          { value: { type: "Gemini" as const, content: "Gemini2_5Pro" as GeminiModel }, label: "Gemini 2.5 Pro" },
          { value: { type: "Gemini" as const, content: "Gemini2_0Flash" as GeminiModel }, label: "Gemini 2.0 Flash" },
        ];
      default:
        return [];
    }
  }, [formData.agent]);

  const handleRepoPathChange = (id: string, newPath: string) => {
    setRepositories(repos => repos.map(repo =>
      repo.id === id ? { ...repo, repo_path: newPath } : repo
    ));
  };

  const handleSetPrimary = (id: string) => {
    setRepositories(repos => repos.map(repo => ({
      ...repo,
      is_primary: repo.id === id
    })));
  };

  const handleMountNameChange = (id: string, newName: string) => {
    setRepositories(repos => repos.map(repo =>
      repo.id === id ? { ...repo, mount_name: newName } : repo
    ));
  };

  const handleBaseBranchChange = (id: string, newBaseBranch: string) => {
    setRepositories(repos => repos.map(repo =>
      repo.id === id ? { ...repo, base_branch: newBaseBranch } : repo
    ));
  };

  const handleAddRepository = () => {
    if (repositories.length >= 5) {
      toast.error("Maximum 5 repositories per session");
      return;
    }

    const newId = String(Date.now());
    setRepositories([...repositories, {
      id: newId,
      repo_path: '',
      mount_name: '',
      is_primary: false,
      base_branch: ''
    }]);
  };

  const handleRemoveRepository = (id: string) => {
    // Don't allow removing if it's the last one
    if (repositories.length === 1) {
      toast.error("Must have at least one repository");
      return;
    }

    const repoToRemove = repositories.find(r => r.id === id);
    const newRepos = repositories.filter(r => r.id !== id);

    // If removing primary, set the first remaining repo as primary
    if (repoToRemove?.is_primary && newRepos.length > 0 && newRepos[0]) {
      newRepos[0].is_primary = true;
    }

    setRepositories(newRepos);
  };

  const validateRepositories = (): string | null => {
    if (repositories.length === 0) {
      return "At least one repository is required";
    }

    // Single mode: Only first repo needs path
    if (!multiRepoEnabled) {
      if (!repositories[0]?.repo_path.trim()) {
        return "Repository path is required";
      }
      return null;
    }

    // Multi mode validation
    if (repositories.length < 2) {
      return "Multi-repository mode requires at least 2 repositories";
    }

    // Check all repos have paths
    if (repositories.some(r => !r.repo_path.trim())) {
      return "All repositories must have a path";
    }

    // Check exactly one primary
    const primaryCount = repositories.filter(r => r.is_primary).length;
    if (primaryCount !== 1) {
      return "Exactly one repository must be marked as primary";
    }

    // Check mount names are valid and unique
    const mountNames = new Set<string>();
    for (const repo of repositories) {
      const name = repo.mount_name.trim();

      if (!name) {
        return "All repositories must have a mount name";
      }

      if (!/^[a-z0-9]([a-z0-9-_]{0,62}[a-z0-9])?$/.test(name)) {
        return `Invalid mount name "${name}": must be alphanumeric with hyphens/underscores, 1-64 characters`;
      }

      if (mountNames.has(name)) {
        return `Duplicate mount name: "${name}"`;
      }

      mountNames.add(name);
    }

    // Check for reserved names
    const reserved = ['workspace', 'clauderon', 'repos', 'primary'];
    for (const repo of repositories) {
      if (reserved.includes(repo.mount_name.toLowerCase())) {
        return `Mount name "${repo.mount_name}" is reserved`;
      }
    }

    // Check backend compatibility
    if ((formData.backend as string) !== "Docker") {
      return "Multi-repository mode is only supported with Docker backend";
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    // Validate storage class for Kubernetes backend
    if ((formData.backend as string) === "Kubernetes" && storageClasses.length > 0) {
      const hasDefault = storageClasses.some(sc => sc.is_default);
      if (!hasDefault && !formData.storage_class) {
        setError("No default storage class available. Please select a storage class.");
        setIsSubmitting(false);
        return;
      }
    }

    try {
      // Validate repositories
      const validationError = validateRepositories();
      if (validationError) {
        setError(validationError);
        setIsSubmitting(false);
        return;
      }

      // Build CreateRepositoryInput array
      // Use repositories array if multi-repo enabled, or if base_branch is specified (for Sprites/K8s)
      const firstRepo = repositories[0];
      if (!firstRepo) {
        throw new Error("No repository specified");
      }
      const needsRepositoriesArray = multiRepoEnabled || firstRepo.base_branch;
      const repoInputs: CreateRepositoryInput[] | undefined = needsRepositoriesArray
        ? repositories.map(repo => ({
            repo_path: repo.repo_path,
            is_primary: repo.is_primary,
            ...(repo.base_branch && { base_branch: repo.base_branch })
          }))
        : undefined;

      const request: CreateSessionRequest = {
        repo_path: firstRepo.repo_path, // Legacy field for backward compat
        ...(repoInputs && { repositories: repoInputs }), // New multi-repo field
        initial_prompt: formData.initial_prompt,
        backend: formData.backend,
        agent: formData.agent,
        ...(formData.model && { model: formData.model }),
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
        ...(formData.storage_class && { storage_class: formData.storage_class }),
      };

      const result = await createSession(request);

      // Upload images if any were selected
      if (selectedFiles.length > 0 && result) {
        toast.info(`Uploading ${String(selectedFiles.length)} image(s)...`);
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
          className="max-w-3xl w-full flex flex-col border-4 border-primary max-h-[90vh]"
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

          {/* Multi-Repository Mode Toggle */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="multi-repo-enabled"
                checked={multiRepoEnabled}
                onChange={(e) => { setMultiRepoEnabled(e.target.checked); }}
                className="cursor-pointer w-4 h-4 rounded border-2 border-input"
              />
              <Label htmlFor="multi-repo-enabled" className="cursor-pointer font-semibold">
                Enable Multi-Repository Mode
              </Label>
            </div>
            <p className="text-sm text-muted-foreground pl-6">
              Mount multiple git repositories in the same session. Only supported with Docker backend.
            </p>
            {multiRepoEnabled && (formData.backend as string) !== "Docker" && (
              <div className="p-3 border-2 text-sm font-mono ml-6" style={{
                backgroundColor: 'hsl(45, 75%, 95%)',
                borderColor: 'hsl(45, 75%, 50%)',
                color: 'hsl(45, 75%, 30%)'
              }}>
                <strong>Warning:</strong> Multi-repository mode requires Docker backend.
                Please select Docker above or disable multi-repository mode.
              </div>
            )}
          </div>

          {/* Repositories Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">
                {multiRepoEnabled ? `Repositories (${String(repositories.length)}/5)` : 'Repository'}
              </Label>
              {multiRepoEnabled && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddRepository}
                  disabled={repositories.length >= 5}
                  className="flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add Repository
                </Button>
              )}
            </div>

            {repositories.map((repo, index) => (
              <div key={repo.id} className="border-2 border-primary p-3 space-y-2" style={{ backgroundColor: 'hsl(220, 15%, 98%)' }}>
                {multiRepoEnabled && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">#{index + 1}</span>
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
                          onClick={() => { handleSetPrimary(repo.id); }}
                          className="text-xs px-2 py-1 border-2 hover:bg-yellow-100 hover:border-yellow-600"
                          title="Set as primary repository"
                        >
                          Set Primary
                        </button>
                      )}
                      {repositories.length > 2 && (
                        <button
                          type="button"
                          onClick={() => { handleRemoveRepository(repo.id); }}
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
                  <Label htmlFor={`repo-path-${repo.id}`} className="text-sm">Repository Path</Label>
                  <RepositoryPathSelector
                    value={repo.repo_path}
                    onChange={(path) => { handleRepoPathChange(repo.id, path); }}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`base-branch-${repo.id}`} className="text-sm">
                    Base Branch <span className="text-xs text-muted-foreground">(optional, for Sprites/K8s)</span>
                  </Label>
                  <input
                    type="text"
                    id={`base-branch-${repo.id}`}
                    value={repo.base_branch}
                    onChange={(e) => { handleBaseBranchChange(repo.id, e.target.value); }}
                    placeholder="main (default)"
                    className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
                    maxLength={128}
                  />
                  <p className="text-xs text-muted-foreground">
                    Branch to clone from for clone-based backends (Sprites, Kubernetes). Leave empty for default branch.
                  </p>
                </div>

                {multiRepoEnabled && (
                  <div className="space-y-2">
                    <Label htmlFor={`mount-name-${repo.id}`} className="text-sm">
                      Mount Name <span className="text-xs text-muted-foreground">(alphanumeric + hyphens/underscores)</span>
                    </Label>
                    <input
                      type="text"
                      id={`mount-name-${repo.id}`}
                      value={repo.mount_name}
                      onChange={(e) => { handleMountNameChange(repo.id, e.target.value); }}
                      placeholder="auto-generated"
                      className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
                      pattern="[a-z0-9][a-z0-9-_]{0,62}[a-z0-9]"
                      maxLength={64}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Container path: {repo.is_primary ? '/workspace' : `/repos/${repo.mount_name || '...'}`}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {repositories.length > 1 && (formData.backend as string) !== "Docker" && (
              <div className="p-3 border-2 text-sm font-mono" style={{
                backgroundColor: 'hsl(45, 75%, 95%)',
                borderColor: 'hsl(45, 75%, 50%)',
                color: 'hsl(45, 75%, 30%)'
              }}>
                <strong>Warning:</strong> Multi-repository sessions are only supported with Docker backend.
                Zellij, Kubernetes, and Sprites backends will reject multi-repo sessions.
              </div>
            )}
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
              placeholder={(formData.agent as string) === "Codex" ? "What should Codex do?" : "What should Claude Code do?"}
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
                {featureFlags?.enable_kubernetes_backend && (
                  <option value="Kubernetes">Kubernetes</option>
                )}
                <option value="Sprites">Sprites</option>
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
                  {featureFlags?.enable_experimental_models && (
                    <>
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
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            {!featureFlags?.enable_experimental_models && (
              <div className="p-3 text-sm border-2 rounded" style={{
                backgroundColor: 'hsl(220, 15%, 95%)',
                borderColor: 'hsl(220, 85%, 70%)',
                color: 'hsl(220, 85%, 30%)'
              }}>
                <strong>Note:</strong> Experimental models (Codex, Gemini) are disabled by default.
                Enable via <code className="px-1 py-0.5 bg-white/60 rounded">--enable-experimental-models</code> flag or config file.
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="model" className="font-semibold">
                Model <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <select
                id="model"
                value={formData.model ? JSON.stringify(formData.model) : ""}
                onChange={(e) => {
                  const value: SessionModel | undefined = e.target.value ? JSON.parse(e.target.value) as SessionModel : undefined;
                  setFormData({ ...formData, model: value });
                }}
                className="cursor-pointer flex h-10 w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Default (CLI default)</option>
                {availableModels.map((opt, i) => (
                  <option key={i} value={JSON.stringify(opt.value)}>
                    {opt.label}
                  </option>
                ))}
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
                className="cursor-pointer flex h-10 w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="ReadWrite">Read-Write</option>
                <option value="ReadOnly">Read-Only</option>
              </select>
            </div>
          </div>

          {/* Agent Capabilities Info */}
          {formData.agent in AGENT_CAPABILITIES && (
            <div className="mt-2 p-3 border-2 text-sm" style={{
              backgroundColor: 'hsl(220, 15%, 98%)',
              borderColor: 'hsl(220, 85%, 65%)',
              color: 'hsl(220, 85%, 20%)'
            }}>
              <p className="font-semibold font-mono mb-2">{AGENT_CAPABILITIES[formData.agent].displayName} Capabilities:</p>
              <ul className="space-y-1.5 pl-1">
                {AGENT_CAPABILITIES[formData.agent].features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    {feature.supported ? (
                      <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <span className={feature.supported ? "text-green-900" : "text-yellow-900"}>
                        {feature.name}
                      </span>
                      {feature.note && (
                        <span className="text-xs block text-muted-foreground mt-0.5">
                          {feature.note}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(formData.backend as string) === "Kubernetes" && (
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
                      onClick={() => { setSelectedFiles(files => files.filter((_, idx) => idx !== i)); }}
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
                  onChange={(e) => { setFormData({ ...formData, container_image: e.target.value }); }}
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
                    onChange={(e) => { setFormData({ ...formData, pull_policy: e.target.value as "always" | "if-not-present" | "never" }); }}
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
                    onChange={(e) => { setFormData({ ...formData, cpu_limit: e.target.value }); }}
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
                    onChange={(e) => { setFormData({ ...formData, memory_limit: e.target.value }); }}
                    className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
                  />
                </div>
              </div>

              {/* Storage Class (Kubernetes only) */}
              {(formData.backend as string) === "Kubernetes" && (
                <div className="space-y-2">
                  <Label htmlFor="storage_class">Storage Class (Kubernetes)</Label>
                  {loadingStorageClasses ? (
                    <div className="text-sm text-muted-foreground">Loading storage classes...</div>
                  ) : storageClasses.length > 0 ? (
                    <>
                      <select
                        id="storage_class"
                        value={formData.storage_class}
                        onChange={(e) => { setFormData({ ...formData, storage_class: e.target.value }); }}
                        className="w-full px-3 py-2 border-2 rounded font-mono text-sm"
                      >
                        <option value="">Use default from config</option>
                        {storageClasses.map((sc) => (
                          <option key={sc.name} value={sc.name}>
                            {sc.name} {sc.is_default ? "(default)" : ""} - {sc.provisioner}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Storage class for persistent volume claims (PVCs). Affects cache and workspace volumes.
                      </p>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No storage classes available. Check cluster configuration.
                    </div>
                  )}
                </div>
              )}
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
