import type { SessionModel } from "@clauderon/client";
import type { FeatureFlags } from "@clauderon/shared";
import { AgentType, BackendType } from "@clauderon/shared";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProviderIcon } from "./provider-icon.tsx";
import type { getModelsForAgent } from "@/lib/model-options";
import type { SessionFormData } from "./advanced-container-settings.tsx";

function toBackendType(value: string): BackendType | undefined {
  const map: Record<string, BackendType> = {
    [BackendType.Docker]: BackendType.Docker,
    [BackendType.Zellij]: BackendType.Zellij,
    [BackendType.AiSandbox]: BackendType.AiSandbox,
  };
  return map[value];
}

function toAgentType(value: string): AgentType | undefined {
  const map: Record<string, AgentType> = {
    [AgentType.ClaudeCode]: AgentType.ClaudeCode,
    [AgentType.Codex]: AgentType.Codex,
    [AgentType.Gemini]: AgentType.Gemini,
  };
  return map[value];
}

function findModelByKey(
  key: string,
  models: { value: SessionModel; label: string }[],
): SessionModel | undefined {
  return models.find((m) => JSON.stringify(m.value) === key)?.value;
}

type AgentModelSelectorProps = {
  formData: SessionFormData;
  setFormData: React.Dispatch<React.SetStateAction<SessionFormData>>;
  featureFlags: FeatureFlags | null;
  availableModels: ReturnType<typeof getModelsForAgent>;
};

export function AgentModelSelector({
  formData,
  setFormData,
  featureFlags,
  availableModels,
}: AgentModelSelectorProps) {
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="backend" className="font-semibold">
            Backend
          </Label>
          <select
            id="backend"
            value={formData.backend}
            onChange={(e) => {
              const backend = toBackendType(e.target.value);
              if (backend != null) {
                setFormData({ ...formData, backend });
              }
            }}
            className="cursor-pointer flex h-10 w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="Docker">Docker</option>
            <option value="Zellij">Zellij</option>
            <option value="AiSandbox">AI Sandbox</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="agent" className="font-semibold">
            Agent
          </Label>
          <Select
            value={formData.agent}
            onValueChange={(value) => {
              const agent = toAgentType(value);
              if (agent != null) {
                setFormData({ ...formData, agent });
              }
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
              {featureFlags?.enable_experimental_models === true && (
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

        {featureFlags?.enable_experimental_models !== true && (
          <div
            className="p-3 text-sm border-2 rounded"
            style={{
              backgroundColor: "hsl(220, 15%, 95%)",
              borderColor: "hsl(220, 85%, 70%)",
              color: "hsl(220, 85%, 30%)",
            }}
          >
            <strong>Note:</strong> Experimental models (Codex, Gemini) are
            disabled by default. Enable via{" "}
            <code className="px-1 py-0.5 bg-white/60 rounded">
              --enable-experimental-models
            </code>{" "}
            flag or config file.
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="model" className="font-semibold">
            Model{" "}
            <span className="text-xs text-muted-foreground">(optional)</span>
          </Label>
          <select
            id="model"
            value={formData.model == null ? "" : JSON.stringify(formData.model)}
            onChange={(e) => {
              const model = findModelByKey(e.target.value, availableModels);
              setFormData({ ...formData, model });
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

      </div>

    </>
  );
}
