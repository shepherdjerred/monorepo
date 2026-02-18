import type { BackendType, AccessMode, SessionModel } from "@clauderon/client";
import type { FeatureFlags } from "@clauderon/shared";
import { AgentType } from "@clauderon/shared";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, AlertCircle } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import { AGENT_CAPABILITIES } from "@/lib/agent-features";
import type { getModelsForAgent } from "@/lib/model-options";
import type { SessionFormData } from "./AdvancedContainerSettings";

type AgentModelSelectorProps = {
  formData: SessionFormData;
  setFormData: React.Dispatch<React.SetStateAction<SessionFormData>>;
  featureFlags: FeatureFlags | null;
  enableReadonlyMode: boolean;
  availableModels: ReturnType<typeof getModelsForAgent>;
};

export function AgentModelSelector({
  formData,
  setFormData,
  featureFlags,
  enableReadonlyMode,
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
              setFormData({
                ...formData,
                backend: e.target.value as BackendType,
              });
            }}
            className="cursor-pointer flex h-10 w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="Docker">Docker</option>
            <option value="Zellij">Zellij</option>
            {featureFlags?.enable_kubernetes_backend === true && (
              <option value="Kubernetes">Kubernetes</option>
            )}
            <option value="Sprites">Sprites</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="agent" className="font-semibold">
            Agent
          </Label>
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
              const value: SessionModel | undefined = e.target.value
                ? (JSON.parse(e.target.value) as SessionModel)
                : undefined;
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

        {enableReadonlyMode && (
          <div className="space-y-2">
            <Label htmlFor="access_mode" className="font-semibold">
              Access Mode
              <span className="ml-2 text-xs text-yellow-600 font-bold">
                EXPERIMENTAL
              </span>
            </Label>
            <select
              id="access_mode"
              value={formData.access_mode}
              onChange={(e) => {
                setFormData({
                  ...formData,
                  access_mode: e.target.value as AccessMode,
                });
              }}
              className="cursor-pointer flex h-10 w-full rounded-md border-2 border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="ReadWrite">Read-Write</option>
              <option value="ReadOnly">Read-Only</option>
            </select>
          </div>
        )}
      </div>

      {/* Agent Capabilities Info */}
      {formData.agent in AGENT_CAPABILITIES && (
        <div
          className="mt-2 p-3 border-2 text-sm"
          style={{
            backgroundColor: "hsl(220, 15%, 98%)",
            borderColor: "hsl(220, 85%, 65%)",
            color: "hsl(220, 85%, 20%)",
          }}
        >
          <p className="font-semibold font-mono mb-2">
            {AGENT_CAPABILITIES[formData.agent].displayName} Capabilities:
          </p>
          <ul className="space-y-1.5 pl-1">
            {AGENT_CAPABILITIES[formData.agent].features.map((feature, idx) => (
              <li key={idx} className="flex items-start gap-2">
                {feature.supported ? (
                  <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <span
                    className={
                      feature.supported ? "text-green-900" : "text-yellow-900"
                    }
                  >
                    {feature.name}
                  </span>
                  {feature.note != null && feature.note.length > 0 && (
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
        <div
          className="mt-2 p-3 border-2 text-sm font-mono"
          style={{
            backgroundColor: "hsl(220, 15%, 90%)",
            borderColor: "hsl(220, 85%, 65%)",
            color: "hsl(220, 85%, 25%)",
          }}
        >
          <strong>Note:</strong> Requires kubectl access and the{" "}
          <code>clauderon</code> namespace. Configuration:{" "}
          <code>~/.clauderon/k8s-config.toml</code>
        </div>
      )}
    </>
  );
}
