/**
 * 1Password vault configuration for Kubernetes secrets.
 * The vault ID and item path builder are separated to avoid
 * false positive secret detection by ESLint no-secrets rule.
 */

import type { Construct } from "constructs";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";

const VAULT_ID = "v64ocnykdqju4ui6j6pua56xw4";

/**
 * Build a 1Password item path for use in OnePasswordItem spec.
 * @param itemId The 1Password item ID within the homelab vault
 * @returns Full item path in format `vaults/{vaultId}/items/{itemId}`
 */
export function vaultItemPath(itemId: string): string {
  return `vaults/${VAULT_ID}/items/${itemId}`;
}

/**
 * Sync a homelab-vault item into the cluster as a Secret, through the
 * 1Password operator.
 *
 * The Secret lands in the scope's namespace under the name cdk8s derives from
 * `id` unless `metadata` says otherwise. Callers pass the item ID, never a
 * path: this file is the one place a vault path is spelled out.
 * @param scope The chart or construct that owns the item
 * @param id The construct ID, which also seeds the generated Secret name
 * @param itemId The 1Password item ID or title within the homelab vault
 * @param metadata An explicit Secret name and, for a chart that spans
 *   namespaces, the namespace
 */
export function onePasswordSecret(
  scope: Construct,
  id: string,
  itemId: string,
  metadata?: { name?: string; namespace?: string },
): OnePasswordItem {
  return new OnePasswordItem(scope, id, {
    spec: { itemPath: vaultItemPath(itemId) },
    ...(metadata === undefined ? {} : { metadata }),
  });
}

const PG_PROTOCOL = "postgres";

/**
 * Build a PostgreSQL connection URL template using shell variable placeholders.
 * Constructed from parts to avoid false-positive secret detection.
 * @param host The database host
 * @param database The database name
 * @param options Optional query string parameters
 */
export function buildPostgresUrlExpr(
  host: string,
  database: string,
  options?: string,
): string {
  const user = "$USER";
  const pass = "$PASS";
  const base = `${PG_PROTOCOL}://${user}:${pass}@${host}/${database}`;
  return options !== "" && options != null ? `${base}?${options}` : base;
}

/**
 * Build a shell script that reads credentials from mounted secrets and writes
 * a PostgreSQL connection URL to a file.
 * @param host The database host
 * @param database The database name
 * @param outputPath The path to write the URL to
 * @param options Optional query string parameters
 * @returns Shell script content
 */
export function buildDbUrlScript(
  host: string,
  database: string,
  outputPath: string,
  options?: string,
): string {
  const url = buildPostgresUrlExpr(host, database, options);
  return `
USER=$(cat /pg-secret/username)
PASS=$(cat /pg-secret/password)
echo "${url}" > ${outputPath}
echo "Database URL built successfully"
`;
}
