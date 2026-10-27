import type { PromotionStore } from "./store.ts";
import { redactAgentTaskPayloadStrings } from "#activities/agent/agent-task-result.ts";
import { redactSecrets } from "#shared/redact.ts";

export function promotionDiagnosticKey(occurrenceId: string): string {
  return `diagnostics/${encodeURIComponent(occurrenceId)}.json`;
}

export async function recordPromotionDiagnostic(input: {
  store: PromotionStore;
  occurrenceId: string;
  tokens: readonly (string | undefined)[];
  diagnostic: unknown;
}): Promise<void> {
  const safe = redactAgentTaskPayloadStrings(input.diagnostic, (text) =>
    redactSecrets(text, input.tokens),
  );
  if (
    !(await input.store.put(
      promotionDiagnosticKey(input.occurrenceId),
      safe,
      undefined,
    ))
  )
    throw new Error("Failed promotion diagnostic already exists");
}
