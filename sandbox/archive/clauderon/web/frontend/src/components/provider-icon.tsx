import { Brain, Code, Sparkles } from "lucide-react";
import { AgentType } from "@clauderon/shared";

type ProviderIconProps = {
  agent: AgentType;
  className?: string;
};

export function ProviderIcon({
  agent,
  className = "w-4 h-4",
}: ProviderIconProps) {
  switch (agent) {
    case AgentType.ClaudeCode:
      return <Brain className={className} />;
    case AgentType.Codex:
      return <Code className={className} />;
    case AgentType.Gemini:
      return <Sparkles className={className} />;
    default:
      return null;
  }
}
