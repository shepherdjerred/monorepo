// Domains managed by this homelab. Used by dns-audit for validation.
// DNS records are managed by OpenTofu (src/tofu/cloudflare/).

// Domains with MX records that actively send/receive email
export const EMAIL_DOMAINS = ["sjer.red", "shepherdjerred.com", "ts-mc.net"];

// Domains without email - checked with --parked flag to skip MX/SPF/DMARC requirements
export const NO_EMAIL_DOMAINS = [
  "scout-for-lol.com",
  "better-skill-capped.com",
  "discord-plays-pokemon.com",
  "clauderon.com",
  "jerred.is",
  "jerredshepherd.com",
  "glitter-boys.com",
];

export const MANAGED_DOMAINS = [...EMAIL_DOMAINS, ...NO_EMAIL_DOMAINS];
