/**
 * The Brim sync archive's age X25519 public recipient. Public by design:
 * every machine encrypts to it, and only the `BRIM_SYNC_AGE_IDENTITY`
 * credential (1Password `brim-sync-age-identity`) decrypts. Rotating the
 * identity means replacing this value and re-pushing.
 */
export const BRIM_SYNC_RECIPIENT =
  // eslint-disable-next-line no-secrets/no-secrets -- age public recipient, not a secret value
  "age1x4qdwxjdvnga07sewwh8g9flmhrxqtmjznaj3e747j039wzaau3suxvcsk";
