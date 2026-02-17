import { Brain, Code, Sparkles } from "lucide-react";
import type { AgentType } from "@clauderon/shared";

type ProviderIconProps = {
  agent: AgentType;
  className?: string;
};

export function ProviderIcon({
  agent,
  className = "w-4 h-4",
}: ProviderIconProps) {
  switch (agent as string) {
    case "ClaudeCode":
      return <Brain className={className} />;
    case "Codex":
      return <Code className={className} />;
    case "Gemini":
      return <Sparkles className={className} />;
    default:
      return null;
  }
}
