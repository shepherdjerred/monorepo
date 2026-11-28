/** Tailscale sets this on every proxied request and strips client copies. */
export const LOGIN_HEADER = "Tailscale-User-Login";

/** The verified login, or null when the request carries none. */
export function operatorLogin(headers: Headers): string | null {
  const login = headers.get(LOGIN_HEADER);
  return login === null || login.length === 0 ? null : login;
}
