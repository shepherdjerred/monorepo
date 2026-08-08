export type E2EConfig = {
  apiUrl: string;
  token: string;
  nonce: string | null;
  /** `tips=off` suppresses first-run popovers during UI automation. */
  tipsOff: boolean;
};

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
  return {
    apiUrl,
    token,
    nonce,
    tipsOff: params.get("tips") === "off",
  };
}
