export type AllowedTool =
  | "Read"
  | "Glob"
  | "Grep"
  | "Bash"
  | "Edit"
  | "Write"
  | "WebSearch"
  | "WebFetch"
  | "Task";

export type PermissionTier = "read-only" | "write-with-approval" | "supervised";

export type Trigger =
  | { type: "cron"; schedule: string; prompt: string }
  | {
      type: "webhook";
      source: string;
      event: string;
      filter?: string;
      promptTemplate: string;
    }
  | { type: "message"; channel: "discord"; promptTemplate: string };

export type AgentDefinition = {
  name: string;
  description: string;
  systemPrompt: string;
  tools: AllowedTool[];
  maxTurns: number;
  permissionTier: PermissionTier;
  triggers: Trigger[];
  memory: { private: string; shared: string[] };
};
