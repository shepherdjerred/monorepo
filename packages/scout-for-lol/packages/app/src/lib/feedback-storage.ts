/**
 * Per-user feedback-prompt flags, keyed by Discord id in localStorage,
 * following the same convention as onboarding-storage.
 *
 * Dismissal is remembered so the prompt is asked once and then never again —
 * the in-app equivalent of the DM message budget.
 */
function dismissedKey(discordId: string): string {
  return `scout_feedback_dismissed_${discordId}`;
}

function submittedKey(discordId: string): string {
  return `scout_feedback_submitted_${discordId}`;
}

function read(key: string): boolean {
  return globalThis.window.localStorage.getItem(key) === "true";
}

function write(key: string): void {
  globalThis.window.localStorage.setItem(key, "true");
}

export function isFeedbackDismissed(discordId: string): boolean {
  return read(dismissedKey(discordId)) || read(submittedKey(discordId));
}

export function markFeedbackDismissed(discordId: string): void {
  write(dismissedKey(discordId));
}

export function markFeedbackSubmitted(discordId: string): void {
  write(submittedKey(discordId));
}
