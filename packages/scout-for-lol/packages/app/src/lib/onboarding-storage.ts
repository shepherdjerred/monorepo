/**
 * Per-user onboarding completion, keyed by Discord id in localStorage (the SPA
 * is always a browser context). The setup wizard records completion, but normal
 * sign-in always reaches the dashboard instead of redirecting into setup.
 */
function completeKey(discordId: string): string {
  return `scout_onboarding_complete_${discordId}`;
}

function write(key: string): void {
  globalThis.window.localStorage.setItem(key, "true");
}

export function markOnboardingComplete(discordId: string): void {
  write(completeKey(discordId));
}

/**
 * A user without a manageable server has not reached a usable first-run
 * state, even if this browser previously recorded a completed or abandoned
 * wizard. Keep sending that user to the install guide until Scout is
 * available somewhere they can configure.
 */
export function shouldRedirectToOnboarding(
  hasManageableGuilds: boolean,
  onboardingComplete: boolean,
): boolean {
  return !hasManageableGuilds || !onboardingComplete;
}
