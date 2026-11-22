import { z } from "zod";

const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9][\w .,:&+/-]{0,62}$/u;

function splitBracketedMailbox(
  raw: string,
): { displayName: string; email: string } | null {
  const openIdx = raw.indexOf("<");
  if (openIdx === -1 || !raw.endsWith(">")) return null;
  const displayName = raw.slice(0, openIdx).trim();
  const email = raw.slice(openIdx + 1, -1).trim();
  const invalid =
    displayName.length === 0 ||
    displayName.includes("<") ||
    displayName.includes(">") ||
    displayName.includes('"') ||
    email.includes("<") ||
    email.includes(">") ||
    /\s/u.test(email);
  return invalid ? { displayName: "", email: "" } : { displayName, email };
}

/**
 * Validates either a bare email (`alerts@sjer.red`) or an RFC 5322 display-name
 * mailbox (`Hub Alerts <alerts@sjer.red>`) with no header-injection characters.
 */
export const MailboxAddressSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .superRefine((value, context) => {
    const bracketed = splitBracketedMailbox(value);
    if (bracketed !== null) {
      if (!DISPLAY_NAME_PATTERN.test(bracketed.displayName)) {
        context.addIssue({
          code: "custom",
          message: `Invalid mailbox display name: ${bracketed.displayName}`,
        });
      }
      if (!z.email().safeParse(bracketed.email).success) {
        context.addIssue({
          code: "custom",
          message: `Invalid mailbox address: ${bracketed.email}`,
        });
      }
      return;
    }
    if (!z.email().safeParse(value).success) {
      context.addIssue({
        code: "custom",
        message: `Invalid email address: ${value}`,
      });
    }
  });

export type MailboxPair = {
  from: string;
  to: string;
};

/** Extract bare `local@domain` from either `Name <local@domain>` or `local@domain`. */
export function extractEmailAddress(mailbox: string): string {
  const parsed = MailboxAddressSchema.parse(mailbox);
  const bracketed = splitBracketedMailbox(parsed);
  return bracketed === null ? parsed : bracketed.email;
}

/** Extract human sender label (`Hub Alerts` from `Hub Alerts <alerts@sjer.red>`). */
export function extractSenderDisplayName(mailbox: string): string {
  const parsed = MailboxAddressSchema.parse(mailbox);
  const bracketed = splitBracketedMailbox(parsed);
  return bracketed === null ? parsed : bracketed.displayName;
}

export const OPS_MAILBOXES = {
  alerts: {
    from: "Hub Alerts <alerts@sjer.red>",
    to: "alerts@sjer.red",
  },
  alertFallback: {
    from: "Hub Alerts <alerts@sjer.red>",
    to: "alerts@sjer.red",
  },
  digests: {
    from: "Hub Digest <digests@sjer.red>",
    to: "digests@sjer.red",
  },
  reports: {
    dependencies: {
      from: "Repo Dependencies <deps@sjer.red>",
      to: "deps@sjer.red",
    },
    ops: {
      from: "Homelab Audit <ops@sjer.red>",
      to: "ops@sjer.red",
    },
    scout: {
      from: "Scout Automation <scout@sjer.red>",
      to: "scout@sjer.red",
    },
    general: {
      from: "Temporal Reports <reports@sjer.red>",
      to: "reports@sjer.red",
    },
  },
} as const satisfies {
  alerts: MailboxPair;
  alertFallback: MailboxPair;
  digests: MailboxPair;
  reports: Record<string, MailboxPair>;
};

/** Resolve the semantic `@sjer.red` sender and recipient for a Temporal report family. */
export function reportMailboxForType(reportType: string): MailboxPair {
  switch (reportType) {
    case "dependency-summary":
      return OPS_MAILBOXES.reports.dependencies;
    case "homelab-audit":
    case "tasknotes-canary":
      return OPS_MAILBOXES.reports.ops;
    case "scout-data-dragon":
    case "scout-lane-priors":
    case "scout-queue-windows":
    case "scout-season-refresh":
      return OPS_MAILBOXES.reports.scout;
    case "main-vuln-scan":
    case "link-rot-scan":
    case "storm-promotion":
    case "agent-task":
      return OPS_MAILBOXES.reports.general;
    default:
      return OPS_MAILBOXES.reports.general;
  }
}
