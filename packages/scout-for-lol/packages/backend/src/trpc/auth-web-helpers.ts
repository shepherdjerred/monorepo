import configuration from "#src/configuration.ts";

export function buildCookie(params: {
  name: string;
  value: string;
  maxAgeSeconds: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax";
}): string {
  const parts = [
    `${params.name}=${encodeURIComponent(params.value)}`,
    "Path=/",
    `Max-Age=${params.maxAgeSeconds.toString()}`,
    `SameSite=${params.sameSite}`,
  ];
  if (params.httpOnly) parts.push("HttpOnly");
  if (params.secure) parts.push("Secure");
  return parts.join("; ");
}

export function getAppOrigin(): string {
  const origin = configuration.webAppOrigin;
  if (origin === undefined || origin.length === 0) {
    throw new Error("WEB_APP_ORIGIN is not configured");
  }
  return origin;
}

export function safeReturnTo(value: string | null): string {
  if (value === null) return "/app/";
  if (value.startsWith("/app/")) return value;
  return "/app/";
}

/** 32 random bytes, hex-encoded. Shared by every flow that mints a CSRF token. */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
