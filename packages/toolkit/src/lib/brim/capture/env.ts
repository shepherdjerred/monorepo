import type { CaptureCli } from "./clis.ts";
import type { BrimCapturePaths } from "./paths.ts";

/** Hosts that always bypass the proxy. */
export const CAPTURE_NO_PROXY = "localhost,127.0.0.1,::1";

/**
 * The environment one CLI needs to run through the capture proxy: the proxy
 * variables (both cases, since runtimes disagree), the CA trust variable its
 * runtime honors, and any opt-in its HTTP stack needs.
 */
export function captureEnvironment(
  cli: CaptureCli,
  paths: BrimCapturePaths,
  port: number,
): [string, string][] {
  const proxy = `http://127.0.0.1:${String(port)}`;
  const trust: [string, string] =
    cli.trust === "node-extra-ca"
      ? ["NODE_EXTRA_CA_CERTS", paths.caCert]
      : cli.trust === "codex-ca"
        ? ["CODEX_CA_CERTIFICATE", paths.caCert]
        : ["SSL_CERT_FILE", paths.bundle];
  return [
    ["HTTPS_PROXY", proxy],
    ["https_proxy", proxy],
    ["HTTP_PROXY", proxy],
    ["http_proxy", proxy],
    ["NO_PROXY", CAPTURE_NO_PROXY],
    ["no_proxy", CAPTURE_NO_PROXY],
    trust,
    ...Object.entries(cli.extraEnv),
  ];
}

/** POSIX single-quoting, safe to `eval` in sh, bash, and zsh. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

export function renderExports(
  environment: readonly [string, string][],
): string {
  return environment
    .map(([name, value]) => `export ${name}=${shellQuote(value)}`)
    .join("\n");
}
