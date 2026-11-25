import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  MailboxAddressSchema,
  extractEmailAddress,
} from "@shepherdjerred/ops-model/email/mailbox.ts";

export const MailClientConfigSchema = z.object({
  token: z.string().min(1).optional(),
  smtpUsername: z.string().min(1).optional(),
  smtpPassword: z.string().min(1).optional(),
  allowedFromDomains: z.array(z.string().min(1)),
});
export type MailClientConfig = z.infer<typeof MailClientConfigSchema>;

export const MailClientsMapSchema = z.record(
  z.string().min(1),
  MailClientConfigSchema,
);
export type MailClientsMap = z.infer<typeof MailClientsMapSchema>;

export type AuthenticatedMailClient = {
  readonly clientId: string;
  readonly config: MailClientConfig;
};

/**
 * Constant-time secret equality check over SHA-256 digests so neither timing
 * nor stored secret length leaks.
 */
export function verifySecretConstantTime(
  candidate: string,
  expected: string,
): boolean {
  const candidateDigest = createHash("sha256")
    .update(candidate, "utf8")
    .digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export function authenticateBearerClient(
  authorizationHeader: string | undefined,
  clients: MailClientsMap,
): AuthenticatedMailClient | null {
  if (authorizationHeader === undefined) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/u.exec(authorizationHeader.trim());
  const candidateToken = match?.[1];
  if (candidateToken === undefined || candidateToken.length === 0) {
    return null;
  }

  let matched: AuthenticatedMailClient | null = null;
  for (const [clientId, config] of Object.entries(clients)) {
    if (config.token !== undefined) {
      const ok = verifySecretConstantTime(candidateToken, config.token);
      if (ok && matched === null) {
        matched = { clientId, config };
      }
    }
  }
  return matched;
}

export function authenticateSmtpClient(
  username: string,
  password: string,
  clients: MailClientsMap,
): AuthenticatedMailClient | null {
  if (username.length === 0 || password.length === 0) {
    return null;
  }

  let matched: AuthenticatedMailClient | null = null;
  for (const [clientId, config] of Object.entries(clients)) {
    if (
      config.smtpUsername !== undefined &&
      config.smtpPassword !== undefined
    ) {
      const userOk = verifySecretConstantTime(username, config.smtpUsername);
      const passOk = verifySecretConstantTime(password, config.smtpPassword);
      if (userOk && passOk && matched === null) {
        matched = { clientId, config };
      }
    }
  }
  return matched;
}

export function extractMailboxDomain(mailboxOrAddress: string): string | null {
  const parsed = MailboxAddressSchema.safeParse(mailboxOrAddress);
  if (!parsed.success) {
    return null;
  }
  const bareEmail = extractEmailAddress(parsed.data);
  const atIndex = bareEmail.lastIndexOf("@");
  return atIndex <= 0 || atIndex === bareEmail.length - 1
    ? null
    : bareEmail.slice(atIndex + 1).toLowerCase();
}

export function isSenderDomainAllowed(
  mailboxOrAddress: string,
  client: MailClientConfig,
): boolean {
  const senderDomain = extractMailboxDomain(mailboxOrAddress);
  if (senderDomain === null) {
    return false;
  }
  for (const allowedRaw of client.allowedFromDomains) {
    const allowed = allowedRaw.trim().toLowerCase();
    if (allowed === "*" || allowed === senderDomain) {
      return true;
    }
  }
  return false;
}
