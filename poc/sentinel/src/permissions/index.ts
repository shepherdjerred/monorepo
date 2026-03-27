import type { AgentDefinition } from "@shepherdjerred/sentinel/types/agent.ts";
import { parseCommand, isAllowedCommand } from "./allowlist.ts";
import { requestApproval, waitForDecision } from "./approval.ts";
import { getConfig } from "@shepherdjerred/sentinel/config/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";

const permLogger = logger.child({ module: "permissions" });

type PermissionResult =
  | { behavior: "allow"; updatedInput?: ToolInput }
  | { behavior: "deny"; message: string };

type ToolInput = Record<string, unknown>;

// Tier 1: tools that are always safe (read-only)
const TIER_1_TOOLS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch"]);

// Tier 3: tools that always require approval
const TIER_3_TOOLS = new Set(["Edit", "Write", "Task"]);

export function buildPermissionHandler(
  agentDef: AgentDefinition,
  sessionId: string,
): (
  toolName: string,
  toolInput: ToolInput,
  options?: { signal: AbortSignal },
) => Promise<PermissionResult> {
  return async (
    toolName: string,
    toolInput: ToolInput,
    _options?: { signal: AbortSignal },
  ): Promise<PermissionResult> => {
    const inputSummary = summarizeInput(toolName, toolInput);

    // Enforce agent tool restrictions: reject tools not in the agent's allowed list
    const allowedToolSet = new Set<string>(agentDef.tools);
    if (!allowedToolSet.has(toolName)) {
      permLogger.warn(
        {
          tool: toolName,
          agent: agentDef.name,
          allowedTools: agentDef.tools,
          decision: "deny",
        },
        "Permission: denied (tool not in agent's allowed tools)",
      );
      return {
        behavior: "deny",
        message: `Tool "${toolName}" is not permitted for agent "${agentDef.name}"`,
      };
    }

    // Enforce permissionTier: read-only agents can only use tier 1 (read-only) tools
    if (
      agentDef.permissionTier === "read-only" &&
      !TIER_1_TOOLS.has(toolName)
    ) {
      permLogger.warn(
        {
          tool: toolName,
          agent: agentDef.name,
          permissionTier: agentDef.permissionTier,
          decision: "deny",
        },
        "Permission: denied (read-only agent cannot use non-read-only tool)",
      );
      return {
        behavior: "deny",
        message: `Tool "${toolName}" is not permitted for read-only agent "${agentDef.name}"`,
      };
    }

    // Tier 1: auto-allow read-only tools
    if (TIER_1_TOOLS.has(toolName)) {
      permLogger.info(
        {
          tool: toolName,
          input: inputSummary,
          decision: "allow",
          tier: 1,
          agent: agentDef.name,
        },
        "Permission: auto-allowed (tier 1)",
      );
      return { behavior: "allow", updatedInput: toolInput };
    }

    // Tier 2: Bash with allowlist
    if (toolName === "Bash") {
      return handleBash(toolInput, inputSummary, agentDef);
    }

    // Tier 3: tools requiring approval
    if (TIER_3_TOOLS.has(toolName)) {
      return handleApproval({
        toolName,
        toolInput,
        inputSummary,
        agentDef,
        sessionId,
      });
    }

    // Unknown tool: deny
    permLogger.warn(
      {
        tool: toolName,
        input: inputSummary,
        decision: "deny",
        agent: agentDef.name,
      },
      "Permission: unknown tool denied",
    );
    return {
      behavior: "deny",
      message: `Unknown tool "${toolName}" is not permitted`,
    };
  };
}

function handleBash(
  toolInput: ToolInput,
  inputSummary: string,
  agentDef: AgentDefinition,
): PermissionResult {
  const command =
    typeof toolInput["command"] === "string" ? toolInput["command"] : "";

  const argv = parseCommand(command);

  if (argv == null) {
    permLogger.info(
      {
        tool: "Bash",
        input: inputSummary,
        decision: "deny",
        tier: 2,
        agent: agentDef.name,
        reason: "shell metacharacters",
      },
      "Permission: denied (shell metacharacters detected)",
    );
    return {
      behavior: "deny",
      message:
        "Command contains shell metacharacters (;|&$`()><) which are not permitted",
    };
  }

  if (argv.length === 0) {
    permLogger.info(
      {
        tool: "Bash",
        input: inputSummary,
        decision: "deny",
        tier: 2,
        agent: agentDef.name,
        reason: "empty command",
      },
      "Permission: denied (empty command)",
    );
    return { behavior: "deny", message: "Empty command is not permitted" };
  }

  const result = isAllowedCommand(argv);

  if (result.allowed) {
    permLogger.info(
      {
        tool: "Bash",
        input: inputSummary,
        decision: "allow",
        tier: 2,
        agent: agentDef.name,
        matchedRule: result.matchedRule,
      },
      "Permission: allowed (bash allowlist)",
    );
    return { behavior: "allow", updatedInput: toolInput };
  }

  // Not in allowlist: deny (in future, could go to approval)
  permLogger.info(
    {
      tool: "Bash",
      input: inputSummary,
      decision: "deny",
      tier: 2,
      agent: agentDef.name,
      reason: "not in allowlist",
    },
    "Permission: denied (command not in allowlist)",
  );
  return {
    behavior: "deny",
    message: `Command "${String(argv[0])}" is not in the allowed command list`,
  };
}

type HandleApprovalParams = {
  toolName: string;
  toolInput: ToolInput;
  inputSummary: string;
  agentDef: AgentDefinition;
  sessionId: string;
};

async function handleApproval(
  params: HandleApprovalParams,
): Promise<PermissionResult> {
  const { toolName, toolInput, inputSummary, agentDef, sessionId } = params;
  const config = getConfig();

  const expiresAt = new Date(Date.now() + config.permissions.approvalTimeoutMs);

  const requestId = await requestApproval({
    agentName: agentDef.name,
    sessionId,
    toolName,
    toolInput: JSON.stringify(toolInput),
    expiresAt,
  });

  const decision = await waitForDecision(
    requestId,
    config.permissions.approvalTimeoutMs,
  );

  permLogger.info(
    {
      tool: toolName,
      input: inputSummary,
      decision: decision.approved ? "allow" : "deny",
      tier: 3,
      agent: agentDef.name,
      decidedBy: decision.decidedBy,
      reason: decision.reason,
    },
    `Permission: ${decision.approved ? "approved" : "denied"} (tier 3 approval)`,
  );

  if (decision.approved) {
    return { behavior: "allow", updatedInput: params.toolInput };
  }

  return {
    behavior: "deny",
    message: `Approval denied: ${decision.reason ?? "no reason provided"}`,
  };
}

const TOOL_SUMMARY_KEYS: Record<string, string> = {
  Bash: "command",
  Read: "file_path",
  Edit: "file_path",
  Write: "file_path",
  Glob: "pattern",
  Grep: "pattern",
};

function summarizeInput(toolName: string, toolInput: ToolInput): string {
  const key = TOOL_SUMMARY_KEYS[toolName];
  if (key != null) {
    const value = toolInput[key];
    if (typeof value === "string") {
      return value.slice(0, 200);
    }
  }

  return JSON.stringify(toolInput).slice(0, 200);
}
