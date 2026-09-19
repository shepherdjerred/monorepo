const MAX_INGRESS_FUTURE_SKEW_MS = 5 * 60 * 1000;

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
    throw new TypeError("Agent chat API clock returned an invalid timestamp");
  }
  if (Date.parse(timestamp) > currentTimeMs + MAX_INGRESS_FUTURE_SKEW_MS) {
    throw new AgentChatTimestampInFutureError();
  }
}
