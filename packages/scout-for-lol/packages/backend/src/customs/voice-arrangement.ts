/**
 * Retry and outcome-capture for Discord voice operations.
 *
 * Split out of `voice-service.ts` because neither function knows anything about
 * customs: one bounds a flaky Discord call, the other records whether a batch of
 * moves succeeded without letting a failure lose the channels that were already
 * created. Keeping them here leaves `voice-service.ts` to the orchestration.
 */

const VOICE_ATTEMPTS = 3;

export async function captureCustomVoiceArrangement<T>(
  channels: T,
  movePlayers: () => Promise<void>,
): Promise<
  | { readonly ok: true; readonly channels: T }
  | { readonly ok: false; readonly channels: T; readonly error: unknown }
> {
  try {
    await movePlayers();
    return { ok: true, channels };
  } catch (error) {
    return { ok: false, channels, error };
  }
}

export async function retryCustomVoiceOperation<T>(
  operation: () => Promise<T>,
  delay: (milliseconds: number) => Promise<void> = async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= VOICE_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < VOICE_ATTEMPTS) await delay(250 * attempt);
    }
  }
  throw new Error("Discord voice operation failed after three attempts", {
    cause: lastError,
  });
}
