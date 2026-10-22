import { truncateGraphemes } from "@shepherdjerred/text";

const MAX_INGRESS_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_GENERATED_TITLE_LENGTH = 80;

/** A single-line chat title from a prompt, cut on grapheme boundaries. */
export function agentChatTitleFromPrompt(prompt: string): string {
  return truncateGraphemes(
    prompt.replaceAll(/\s+/g, " ").trim(),
    MAX_GENERATED_TITLE_LENGTH,
    "...",
  );
}

export class AgentChatTimestampInFutureError extends Error {
  public constructor() {
    super("submittedAt is too far in the future");
    this.name = "AgentChatTimestampInFutureError";
  }
}

export function validateAgentChatIngressTimestamp(
  timestamp: string,
  currentTime: string,
): void {
  const currentTimeMs = Date.parse(currentTime);
  if (Number.isNaN(currentTimeMs)) {
    throw new TypeError(
      "Agent chat ingress clock returned an invalid timestamp",
    );
  }
  if (Date.parse(timestamp) > currentTimeMs + MAX_INGRESS_FUTURE_SKEW_MS) {
    throw new AgentChatTimestampInFutureError();
  }
}
