import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  MailboxAddressSchema,
  reportMailboxForType,
} from "@shepherdjerred/ops-model/email/mailbox.ts";
import { z } from "zod/v4";

export const DEFAULT_MAIL_RECIPIENT = "dependencies@sjer.red";
export const DEFAULT_MAIL_SENDER = "deps@sjer.red";

/** Email routing is resolved per delivery activity; credentials remain in env. */
export async function mailAddressesConfig() {
  const resolver = defineConfig({
    definition: {
      recipient: {
        schema: z.email(),
        sources: ["flag", "default"],
        default: DEFAULT_MAIL_RECIPIENT,
        names: { flag: "temporal-email-recipient" },
      },
      sender: {
        schema: MailboxAddressSchema,
        sources: ["flag", "default"],
        default: DEFAULT_MAIL_SENDER,
        names: { flag: "temporal-email-sender" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "temporal-reports-worker",
        kinds: { recipient: "string", sender: "string" },
      }),
    },
    hooks: {
      onSourceError: (key, source, message) => {
        console.warn(`[Config] ${key} ${source}: ${message}`);
      },
    },
  });
  const [recipient, sender] = await Promise.all([
    resolver.value("recipient"),
    resolver.value("sender"),
  ]);
  return { recipient, sender };
}

/**
 * Resolve semantic `@sjer.red` sender and recipient for a report family while
 * honoring explicit non-default Flags overrides on either flag.
 */
export async function resolveMailAddressesForReport(
  reportType: string,
): Promise<{ recipient: string; sender: string }> {
  const configured = await mailAddressesConfig();
  const mailbox = reportMailboxForType(reportType);
  return {
    recipient:
      configured.recipient === DEFAULT_MAIL_RECIPIENT
        ? mailbox.to
        : configured.recipient,
    sender:
      configured.sender === DEFAULT_MAIL_SENDER
        ? mailbox.from
        : configured.sender,
  };
}
