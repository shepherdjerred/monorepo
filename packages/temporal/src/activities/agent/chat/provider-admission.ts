import { ApplicationFailure } from "@temporalio/activity";
import type { RunAgentChatTurnInput } from "#shared/agent/agent-chat.ts";
import type { AgentChatObjectStore } from "./session-store.ts";

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

async function ownsProviderAdmission(input: {
  store: AgentChatObjectStore;
  key: string;
  claim: Uint8Array;
}): Promise<boolean> {
  return bytesEqual(await input.store.get(input.key), input.claim);
}

export function rejectExpiredProviderAdmission(
  input: RunAgentChatTurnInput,
  now: Date,
): void {
  if (
    input.request.providerStartDeadline === undefined ||
    now.getTime() < Date.parse(input.request.providerStartDeadline)
  ) {
    return;
  }
  throw ApplicationFailure.nonRetryable(
    `Agent chat turn ${input.request.turnId} exceeded its provider admission deadline`,
    "AgentChatTurnExpired",
  );
}

export async function claimProviderAdmission(input: {
  store: AgentChatObjectStore;
  key: string;
  turn: RunAgentChatTurnInput;
  now: () => Date;
  signal: AbortSignal;
  onAdmission: () => void;
}): Promise<void> {
  input.signal.throwIfAborted();
  rejectExpiredProviderAdmission(input.turn, input.now());
  // Conditional creation is the crash-safe admission barrier. Overlapping
  // Activity attempts race here, and exactly one may launch the provider.
  const claim = new TextEncoder().encode(crypto.randomUUID());
  let admitted: boolean;
  try {
    admitted = await input.store.create(input.key, claim);
  } catch (error: unknown) {
    try {
      admitted = await ownsProviderAdmission({
        store: input.store,
        key: input.key,
        claim,
      });
    } catch {
      throw error;
    }
  }
  if (!admitted) {
    admitted = await ownsProviderAdmission({
      store: input.store,
      key: input.key,
      claim,
    });
  }
  if (!admitted) {
    throw ApplicationFailure.nonRetryable(
      `Agent chat turn ${input.turn.request.turnId} was already durably admitted without a publication checkpoint; refusing to replay its provider call`,
      "AgentChatPublicationCheckpointMissing",
    );
  }
  if (input.signal.aborted) {
    // No provider work has started, so cancellation remains retry-safe. Remove
    // only the marker this attempt just created before surfacing the abort.
    await input.store.delete(input.key);
    input.signal.throwIfAborted();
  }
  input.onAdmission();
  // Storage acknowledgement can cross the deadline. Keep the marker so the
  // expired turn cannot replay, but do not begin provider effects.
  rejectExpiredProviderAdmission(input.turn, input.now());
}
