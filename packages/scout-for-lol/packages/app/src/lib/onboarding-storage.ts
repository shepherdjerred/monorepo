/**
 * Per-user onboarding flags, keyed by Discord id in localStorage (the SPA
 * is always a browser context). `seen` gates the one-time auto-redirect
 * into the wizard; `complete` gates the "Get started" banner.
 */
function seenKey(discordId: string): string {
  return `scout_onboarding_seen_${discordId}`;
}

function completeKey(discordId: string): string {
  return `scout_onboarding_complete_${discordId}`;
}

function read(key: string): boolean {
  return globalThis.window.localStorage.getItem(key) === "true";
}

function write(key: string): void {
  globalThis.window.localStorage.setItem(key, "true");
}

export function isOnboardingSeen(discordId: string): boolean {
  return read(seenKey(discordId));
}

export function markOnboardingSeen(discordId: string): void {
  write(seenKey(discordId));
}

export function isOnboardingComplete(discordId: string): boolean {
  return read(completeKey(discordId));
}

export function markOnboardingComplete(discordId: string): void {
  write(completeKey(discordId));
}
