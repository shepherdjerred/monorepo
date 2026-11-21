import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  MailboxAddressSchema,
  reportMailboxForType,
} from "@shepherdjerred/ops-model/email/mailbox.ts";
import { z } from "zod/v4";

export const DEFAULT_POSTAL_RECIPIENT = "dependencies@sjer.red";
export const DEFAULT_POSTAL_SENDER = "deps@sjer.red";

/** Email routing is resolved per delivery activity; credentials remain in env. */
export async function postalAddressesConfig() {
  const resolver = defineConfig({
    definition: {
      recipient: {
        schema: z.email(),
        sources: ["flag", "default"],
        default: DEFAULT_POSTAL_RECIPIENT,
        names: { flag: "temporal-email-recipient" },
      },
      sender: {
        schema: MailboxAddressSchema,
        sources: ["flag", "default"],
        default: DEFAULT_POSTAL_SENDER,
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
 * honoring explicit non-default Flipt overrides on either flag.
 */
export async function resolvePostalAddressesForReport(
  reportType: string,
): Promise<{ recipient: string; sender: string }> {
  const configured = await postalAddressesConfig();
  const mailbox = reportMailboxForType(reportType);
  return {
    recipient:
      configured.recipient === DEFAULT_POSTAL_RECIPIENT
        ? mailbox.to
        : configured.recipient,
    sender:
      configured.sender === DEFAULT_POSTAL_SENDER
        ? mailbox.from
        : configured.sender,
  };
}
