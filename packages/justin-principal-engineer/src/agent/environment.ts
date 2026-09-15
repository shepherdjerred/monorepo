const INHERITED_KEYS = new Set([
  "HOME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

export function agentEnvironment(
  credential: Readonly<Record<string, string>>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (typeof value === "string" && INHERITED_KEYS.has(key)) {
      environment[key] = value;
    }
  }
  return { ...environment, ...credential };
}
