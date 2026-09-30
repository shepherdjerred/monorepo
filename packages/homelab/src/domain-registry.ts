import { z } from "zod";
import inventory from "./domain-registry.json";

export const MailPolicySchema = z.strictObject({
  version: z.literal("STSv1"),
  mode: z.literal("enforce"),
  mx: z.tuple([
    z.literal("in1-smtp.messagingengine.com"),
    z.literal("in2-smtp.messagingengine.com"),
  ]),
  maxAge: z.literal(86_400),
});

export const DomainRegistrySchema = z.strictObject({
  domains: z
    .record(
      z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/),
      z.strictObject({
        fastmailReady: z.boolean(),
        wildcardMail: z.boolean(),
        tls13: z.enum(["on", "zrt"]),
        mtaStsPublished: z.boolean(),
      }),
    )
    .refine(
      (domains) => Object.keys(domains).length > 0,
      "Domain inventory is empty",
    ),
  mailPolicy: MailPolicySchema,
});

export type MailPolicy = z.infer<typeof MailPolicySchema>;

export function mailPolicyText(policy: MailPolicy): string {
  return [
    `version: ${policy.version}`,
    `mode: ${policy.mode}`,
    ...policy.mx.map((mx) => `mx: ${mx}`),
    `max_age: ${String(policy.maxAge)}`,
    "",
  ].join("\n");
}

export const domainRegistry = DomainRegistrySchema.parse(inventory);
export const mailPolicyHosts = Object.keys(domainRegistry.domains).map(
  (domain) => ({
    hostname: `mta-sts.${domain}`,
    policy: domainRegistry.mailPolicy,
  }),
);

// RE2, used by blackbox-exporter, accepts these ordinary anchored literals.
export const mailPolicyBodyPattern = `^${mailPolicyText(domainRegistry.mailPolicy).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}$`;
