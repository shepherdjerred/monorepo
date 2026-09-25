import type { AgentTurnOutcome, RunAgentTurnInput } from "./contract.ts";
import { runClaudeAgentTurn } from "./claude.ts";
import { runCodexAgentTurn } from "./codex.ts";

/** Execute one resumable provider turn through the shared activity runtime. */
export function runAgentTurn(
  input: RunAgentTurnInput,
): Promise<AgentTurnOutcome> {
  return input.provider === "codex"
    ? runCodexAgentTurn(input)
    : runClaudeAgentTurn(input);
}
