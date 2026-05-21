const PROVIDER_ERROR_REPORT_INTERVAL_MS = 15 * 60 * 1000;
const lastProviderErrorReportAtByKey = new Map<string, number>();

export type AnthropicProviderErrorKind = "credit_balance_low" | "rate_limit";

export type AnthropicProviderErrorClassification = {
  kind: AnthropicProviderErrorKind;
  captureMessage: string;
  fingerprint: string;
  providerTag: string;
  requestId: string | undefined;
  originalMessage: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readProperty(value: unknown, key: string): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  return Reflect.get(new Object(value), key);
}

function extractAnthropicRequestId(message: string): string | undefined {
  const match = /request[_ -]?id["':=\s]+([\w-]+)/i.exec(message);
  return match?.[1];
}

export function classifyAnthropicProviderError(
  error: unknown,
): AnthropicProviderErrorClassification | null {
  const message = errorMessage(error);
  const status = readProperty(error, "status");
  const nestedError = readProperty(error, "error");
  const errorType = readProperty(nestedError, "type");
  const requestId = extractAnthropicRequestId(message);

  if (message.includes("credit balance is too low")) {
    return {
      kind: "credit_balance_low",
      captureMessage: "Anthropic provider error: credit_balance_low",
      fingerprint: "anthropic-credit-balance-low",
      providerTag: "anthropic_credit_balance_low",
      requestId,
      originalMessage: message,
    };
  }

  if (
    status === 429 ||
    errorType === "rate_limit_error" ||
    message.includes("rate_limit_error") ||
    message.toLowerCase().includes("rate limit")
  ) {
    return {
      kind: "rate_limit",
      captureMessage: "Anthropic provider error: rate_limit",
      fingerprint: "anthropic-rate-limit",
      providerTag: "anthropic_rate_limit",
      requestId,
      originalMessage: message,
    };
  }

  return null;
}

export function shouldReportAnthropicProviderError(
  classification: AnthropicProviderErrorClassification,
  nowMs = Date.now(),
): boolean {
  const key = classification.kind;
  const lastReportedAt = lastProviderErrorReportAtByKey.get(key);
  if (
    lastReportedAt !== undefined &&
    nowMs - lastReportedAt < PROVIDER_ERROR_REPORT_INTERVAL_MS
  ) {
    return false;
  }
  lastProviderErrorReportAtByKey.set(key, nowMs);
  return true;
}

export function resetAnthropicProviderErrorReporterForTests(): void {
  lastProviderErrorReportAtByKey.clear();
}
