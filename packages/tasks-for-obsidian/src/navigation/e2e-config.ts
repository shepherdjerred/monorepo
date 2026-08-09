export type E2EConfig = {
  apiUrl: string;
  token: string;
  nonce: string | null;
  today: string | null;
  /** `tips=off` suppresses first-run popovers during UI automation. */
  tipsOff: boolean;
};

let configuredToday: string | null = null;
let e2eConfigActive = false;

export function markE2EConfigActive(): void {
  e2eConfigActive = true;
}

/**
 * iOS accessibility snapshots can take longer than the product's five-second
 * Undo window. Debug E2E sessions stretch the same inactivity timer so Maestro
 * can exercise the action; release builds never activate this override.
 */
export function e2eUndoToastMs(productDurationMs: number): number {
  return e2eConfigActive ? 60_000 : productDurationMs;
}

export function setE2EToday(today: string | null): void {
  configuredToday = today;
}

export function e2eNow(): Date {
  return configuredToday === null
    ? new Date()
    : new Date(`${configuredToday}T12:00:00`);
}

export function parseE2EConfigUrl(url: string): E2EConfig | null {
  const separatorIndex = url.indexOf("?");
  if (separatorIndex === -1) return null;
  const base = url.slice(0, separatorIndex);
  if (base !== "tasknotes://e2e-config") return null;
  // React Native's URL polyfill mishandles custom schemes, so split the
  // query string off manually and parse it with URLSearchParams.
  const params = new URLSearchParams(url.slice(separatorIndex + 1));
  const apiUrl = params.get("apiUrl");
  const token = params.get("token");
  if (apiUrl === null || token === null || apiUrl.length === 0) return null;
  const nonce = params.get("nonce");
  if (nonce !== null && !/^[a-z0-9-]+$/.test(nonce)) return null;
  const today = params.get("today");
  if (today !== null && today !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return null;
  }
  return {
    apiUrl,
    token,
    nonce,
    today: today === "" ? null : today,
    tipsOff: params.get("tips") === "off",
  };
}
