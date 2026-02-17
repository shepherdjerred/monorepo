/**
 * Information about a Kubernetes storage class
 */
export type StorageClassInfo = {
  name: string;
  provisioner: string;
  is_default: boolean;
};

/**
 * Configuration options for ClauderonClient
 */
export type ClauderonClientConfig = {
  /**
   * Base URL for the Clauderon HTTP API
   * @default "http://localhost:3030"
   */
  baseUrl?: string;

  /**
   * Custom fetch implementation (useful for testing)
   */
  fetch?: typeof fetch;
};

/**
 * Get the default base URL based on the current environment.
 * In browser context, derives from window.location.
 * In non-browser context, defaults to localhost:3030.
 */
export function getDefaultBaseUrl(): string {
  if ("window" in globalThis) {
    return `${globalThis.location.protocol}//${globalThis.location.host}`;
  }
  return "http://localhost:3030";
}
