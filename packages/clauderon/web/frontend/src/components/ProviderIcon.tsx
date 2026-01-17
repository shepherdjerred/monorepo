import { Brain, Code, Sparkles } from "lucide-react";
import type { AgentType } from "@clauderon/shared";

type ProviderIconProps = {
  agent: AgentType;
  className?: string;
}

export function ProviderIcon({ agent, className = "w-4 h-4" }: ProviderIconProps) {
  switch (agent) {
    case "ClaudeCode":
      return <Brain className={className} title="Claude Code" />;
    case "Codex":
      return <Code className={className} title="Codex" />;
    case "Gemini":
      return <Sparkles className={className} title="Gemini" />;
    default:
      return null;
  }
}
