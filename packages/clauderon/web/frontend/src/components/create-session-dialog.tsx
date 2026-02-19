import { useState, useMemo } from "react";
import type {
  CreateSessionRequest,
  StorageClassInfo,
  CreateRepositoryInput,
} from "@clauderon/client";
import { AgentType, BackendType, AccessMode } from "@clauderon/shared";
import { useSessionContext } from "@shepherdjerred/clauderon/web/frontend/src/contexts/SessionContext";
import { useFeatureFlags } from "@shepherdjerred/clauderon/web/frontend/src/contexts/FeatureFlagsContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, Plus } from "lucide-react";
import { RepositoryEntryForm } from "./RepositoryEntryForm.tsx";
import { AgentModelSelector } from "./AgentModelSelector.tsx";
import { toast } from "sonner";
import { getModelsForAgent, validateRepositories } from "@/lib/model-options";
import {
  AdvancedContainerSettings,
  type SessionFormData,
} from "./AdvancedContainerSettings.tsx";
import { useRepositoryHandlers } from "@/hooks/useRepositoryHandlers";
import { ImageAttachmentInput } from "./image-attachment-input.tsx";

type CreateSessionDialogProps = {
  onClose: () => void;
};

export function CreateSessionDialog({ onClose }: CreateSessionDialogProps) {
  const { createSession, client } = useSessionContext();
  const { flags } = useFeatureFlags();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [storageClasses] = useState<StorageClassInfo[]>([]);
  const [loadingStorageClasses] = useState(false);

  const {
    multiRepoEnabled,
    setMultiRepoEnabled,
    repositories,
    handleRepoPathChange,
    handleSetPrimary,
    handleMountNameChange,
    handleBaseBranchChange,
    handleAddRepository,
    handleRemoveRepository,
  } = useRepositoryHandlers();

  const [formData, setFormData] = useState<SessionFormData>({
    initial_prompt: "",
    backend: BackendType.Docker,
    agent: AgentType.ClaudeCode,
    model: undefined,
    access_mode: AccessMode.ReadWrite,
    plan_mode: true,
    dangerous_skip_checks: true,
    container_image: "",
    pull_policy: "if-not-present",
    cpu_limit: "",
    memory_limit: "",
    storage_class: "",
  });

  // Auto-check dangerous_skip_checks for Docker, Kubernetes, and Sprites, uncheck for Zellij
  ;

  // Fetch storage classes when Kubernetes backend is selected
  ;

  // Reset model when agent changes
  ;

  // Fetch feature flags on mount
  ;

  // Reset backend if Kubernetes is disabled
  ;

  // Sync repositories array with multi-repo toggle
  ;

  const availableModels = useMemo(
    () => getModelsForAgent(formData.agent),
    [formData.agent],
  );

  const buildSessionRequest = (): CreateSessionRequest => {
    // Build CreateRepositoryInput array
    // Use repositories array if multi-repo enabled, or if base_branch is specified (for Sprites/K8s)
    const firstRepo = repositories[0];
    if (firstRepo == null) {
      throw new Error("No repository specified");
    }
    const needsRepositoriesArray =
      multiRepoEnabled || firstRepo.base_branch.length > 0;
    const repoInputs: CreateRepositoryInput[] | undefined =
      needsRepositoriesArray
        ? repositories.map((repo) => ({
            repo_path: repo.repo_path,
            is_primary: repo.is_primary,
            ...(repo.base_branch && { base_branch: repo.base_branch }),
          }))
        : undefined;

    return {
      repo_path: firstRepo.repo_path, // Legacy field for backward compat
      ...(repoInputs != null && { repositories: repoInputs }), // New multi-repo field
      initial_prompt: formData.initial_prompt,
      backend: formData.backend,
      agent: formData.agent,
      ...(formData.model != null && { model: formData.model }),
      dangerous_skip_checks: formData.dangerous_skip_checks,
      print_mode: false,
      plan_mode: formData.plan_mode,
      access_mode: formData.access_mode,
      images: [],
      // Include container settings if specified
      pull_policy: formData.pull_policy,
      ...(formData.container_image && {
        container_image: formData.container_image,
      }),
      ...(formData.cpu_limit && { cpu_limit: formData.cpu_limit }),
      ...(formData.memory_limit && { memory_limit: formData.memory_limit }),
      ...(formData.storage_class && {
        storage_class: formData.storage_class,
      }),
    };
  };

  const uploadImages = async (sessionId: string) => {
    if (selectedFiles.length === 0) {
      return;
    }
    toast.info(`Uploading ${String(selectedFiles.length)} image(s)...`);
    for (const file of selectedFiles) {
      try {
        await client.uploadImage(sessionId, file);
      } catch (error_) {
        console.error("Failed to upload image:", error_);
        toast.warning(`Failed to upload ${file.name}`);
      }
    }
  };

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    // Validate storage class for Kubernetes backend
    if (
      formData.backend === BackendType.Kubernetes &&
      storageClasses.length > 0
    ) {
      const hasDefault = storageClasses.some((sc) => sc.is_default);
      if (!hasDefault && !formData.storage_class) {
        setError(
          "No default storage class available. Please select a storage class.",
        );
        setIsSubmitting(false);
        return;
      }
    }

    try {
      // Validate repositories
      const validationError = validateRepositories(
        repositories,
        multiRepoEnabled,
        formData.backend,
      );
      if (validationError != null && validationError.length > 0) {
        setError(validationError);
        setIsSubmitting(false);
        return;
      }

      const request = buildSessionRequest();
      const result = await createSession(request);

      // Upload images if any were selected
      if (result) {
        await uploadImages(result);
      }

      toast.success("Session created successfully");
      onClose();
    } catch (error_) {
      const errorMsg = error_ instanceof Error ? error_.message : String(error_);
      setError(errorMsg);
      toast.error(`Failed to create session: ${errorMsg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle ESC key
  ;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: "hsl(220, 90%, 8%)",
          opacity: 0.85,
        }}
        onPointerDown={onClose}
        aria-hidden="true"
      />
      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-8 z-50">
        <div
          className="max-w-3xl w-full flex flex-col border-4 border-primary max-h-[90vh]"
          style={{
            backgroundColor: "hsl(220, 15%, 95%)",
            boxShadow:
              "12px 12px 0 hsl(220, 85%, 25%), 24px 24px 0 hsl(220, 90%, 10%)",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between p-4 border-b-4 border-primary"
            style={{ backgroundColor: "hsl(220, 85%, 25%)" }}
          >
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
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="p-6 space-y-6 overflow-y-auto"
            style={{ backgroundColor: "hsl(220, 15%, 95%)" }}
          >
            {error != null && error.length > 0 && (
              <div
                className="p-4 border-4 font-mono"
                style={{
                  backgroundColor: "hsl(0, 75%, 95%)",
                  color: "hsl(0, 75%, 40%)",
                  borderColor: "hsl(0, 75%, 50%)",
                }}
              >
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
                  onChange={(e) => {
                    setMultiRepoEnabled(e.target.checked);
                  }}
                  className="cursor-pointer w-4 h-4 rounded border-2 border-input"
                />
                <Label
                  htmlFor="multi-repo-enabled"
                  className="cursor-pointer font-semibold"
                >
                  Enable Multi-Repository Mode
                </Label>
              </div>
              <p className="text-sm text-muted-foreground pl-6">
                Mount multiple git repositories in the same session. Only
                supported with Docker backend.
              </p>
              {multiRepoEnabled &&
                formData.backend !== BackendType.Docker && (
                  <div
                    className="p-3 border-2 text-sm font-mono ml-6"
                    style={{
                      backgroundColor: "hsl(45, 75%, 95%)",
                      borderColor: "hsl(45, 75%, 50%)",
                      color: "hsl(45, 75%, 30%)",
                    }}
                  >
                    <strong>Warning:</strong> Multi-repository mode requires
                    Docker backend. Please select Docker above or disable
                    multi-repository mode.
                  </div>
                )}
            </div>

            {/* Repositories Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="font-semibold">
                  {multiRepoEnabled
                    ? `Repositories (${String(repositories.length)}/5)`
                    : "Repository"}
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
                <RepositoryEntryForm
                  key={repo.id}
                  repo={repo}
                  index={index}
                  multiRepoEnabled={multiRepoEnabled}
                  repositoriesCount={repositories.length}
                  onPathChange={handleRepoPathChange}
                  onBaseBranchChange={handleBaseBranchChange}
                  onMountNameChange={handleMountNameChange}
                  onSetPrimary={handleSetPrimary}
                  onRemove={handleRemoveRepository}
                />
              ))}

              {repositories.length > 1 &&
                formData.backend !== BackendType.Docker && (
                  <div
                    className="p-3 border-2 text-sm font-mono"
                    style={{
                      backgroundColor: "hsl(45, 75%, 95%)",
                      borderColor: "hsl(45, 75%, 50%)",
                      color: "hsl(45, 75%, 30%)",
                    }}
                  >
                    <strong>Warning:</strong> Multi-repository sessions are only
                    supported with Docker backend. Zellij, Kubernetes, and
                    Sprites backends will reject multi-repo sessions.
                  </div>
                )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="initial_prompt" className="font-semibold">
                Initial Prompt
              </Label>
              <textarea
                id="initial_prompt"
                value={formData.initial_prompt}
                onChange={(e) => {
                  setFormData({ ...formData, initial_prompt: e.target.value });
                }}
                className="flex w-full rounded-md border-2 border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm min-h-[100px]"
                placeholder={
                  formData.agent === AgentType.Codex
                    ? "What should Codex do?"
                    : "What should Claude Code do?"
                }
                required
              />
            </div>

            <AgentModelSelector
              formData={formData}
              setFormData={setFormData}
              featureFlags={featureFlags}
              enableReadonlyMode={flags?.enable_readonly_mode === true}
              availableModels={availableModels}
            />

            <ImageAttachmentInput
              selectedFiles={selectedFiles}
              setSelectedFiles={setSelectedFiles}
            />

            <AdvancedContainerSettings
              formData={formData}
              setFormData={setFormData}
              loadingStorageClasses={loadingStorageClasses}
              storageClasses={storageClasses}
            />

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="plan-mode"
                checked={formData.plan_mode}
                onChange={(e) => {
                  setFormData({ ...formData, plan_mode: e.target.checked });
                }}
                className="cursor-pointer w-4 h-4 rounded border-2 border-input"
              />
              <Label htmlFor="plan-mode" className="cursor-pointer">
                Start in plan mode
                {flags?.enable_readonly_mode === true ? " (read-only)" : ""}
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="dangerous-skip-checks"
                checked={formData.dangerous_skip_checks}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    dangerous_skip_checks: e.target.checked,
                  });
                }}
                className="cursor-pointer w-4 h-4"
              />
              <label
                htmlFor="dangerous-skip-checks"
                className="cursor-pointer text-sm text-destructive font-medium"
              >
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
