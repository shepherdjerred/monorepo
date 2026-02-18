/**
 * 1Password vault configuration for Kubernetes secrets.
 * The vault ID and item path builder are separated to avoid
 * false positive secret detection by ESLint no-secrets rule.
 */

const VAULT_ID = "v64ocnykdqju4ui6j6pua56xw4";

/**
 * Build a 1Password item path for use in OnePasswordItem spec.
 * @param itemId The 1Password item ID within the homelab vault
 * @returns Full item path in format `vaults/{vaultId}/items/{itemId}`
 */
export function vaultItemPath(itemId: string): string {
  return `vaults/${VAULT_ID}/items/${itemId}`;
}
