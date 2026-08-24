/**
 * Results the homelab audit passes between its own steps.
 *
 * The archive step consumes them, and the audit activity consumes the archive
 * step's helpers, so declaring these beside the audit made the two modules
 * import each other.
 */

export type HomelabAuditAgentResult = {
  markdown: string;
  durationMs: number;
  numTurns: number | undefined;
  totalCostUsd: number | undefined;
  model: string;
};

export type HomelabAuditEmailInput = {
  date: string;
  markdown: string;
};

export type HomelabAuditEmailResult = {
  subject: string;
  messageId: string;
  recipientId: number | "unknown";
};
