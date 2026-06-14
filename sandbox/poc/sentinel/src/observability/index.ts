import { initializeSentry, flushSentry } from "./sentry.ts";

export function initializeObservability(): void {
  initializeSentry();
}

export async function shutdownObservability(): Promise<void> {
  await flushSentry();
}
