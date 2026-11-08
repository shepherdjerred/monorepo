import { createHmac } from "node:crypto";
import { assertSecret, selectCredentials } from "../mac-account-contract.ts";

export const maximumCredentialBytes = 65_536;
export type CredentialLocator = {
  account: string;
  vault: string;
  item: string;
};
export class LocalCredentialFailure extends Error {
  constructor(readonly classification: string) {
    super(classification);
  }
}
function invalid(): never {
  throw new LocalCredentialFailure("local_credentials_invalid_payload");
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    invalid();
  return value as Record<string, unknown>;
}
export function recordKey(locator: CredentialLocator) {
  const values = [locator.account, locator.vault, locator.item];
  if (!values.every((value) => /^[A-Za-z0-9]{20,32}$/u.test(value))) invalid();
  return values.join(":");
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join("\0") !== keys.sort().join("\0"))
    invalid();
}
function base32(secret: string) {
  const normalized = secret.toUpperCase().replace(/=+$/u, "");
  if (!/^[A-Z2-7]{16,1024}$/u.test(normalized)) invalid();
  let bits = 0,
    value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    value =
      (value << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 255);
    }
  }
  if (
    (bits > 0 && (value & ((1 << bits) - 1)) !== 0) ||
    [1, 3, 6].includes(normalized.length % 8)
  )
    invalid();
  return { normalized, bytes: Buffer.from(output) };
}
export function parseOtpSeed(value: string): {
  secret: string;
  algorithm: "sha1" | "sha256" | "sha512";
  digits: 6;
  period: number;
} {
  try {
    assertSecret(value, 4096);
    if (!value.startsWith("otpauth://"))
      return {
        secret: base32(value).normalized,
        algorithm: "sha1" as const,
        digits: 6,
        period: 30,
      };
    const uri = new URL(value);
    if (
      uri.protocol !== "otpauth:" ||
      uri.hostname !== "totp" ||
      uri.username ||
      uri.password ||
      uri.port ||
      uri.hash
    )
      invalid();
    const keys = [...uri.searchParams.keys()];
    if (
      new Set(keys).size !== keys.length ||
      keys.some(
        (key) =>
          !["secret", "issuer", "algorithm", "digits", "period"].includes(key),
      )
    )
      invalid();
    const algorithm = (
      uri.searchParams.get("algorithm") ?? "SHA1"
    ).toLowerCase();
    if (
      algorithm !== "sha1" &&
      algorithm !== "sha256" &&
      algorithm !== "sha512"
    )
      invalid();
    const digits = uri.searchParams.get("digits") ?? "6",
      period = uri.searchParams.get("period") ?? "30";
    if (
      digits !== "6" ||
      !/^[1-9][0-9]{0,2}$/u.test(period) ||
      Number(period) > 300
    )
      invalid();
    return {
      secret: base32(uri.searchParams.get("secret") ?? "").normalized,
      algorithm,
      digits: 6,
      period: Number(period),
    };
  } catch {
    invalid();
  }
}
export function generateTotp(
  secret: string,
  seconds: number,
  algorithm: "sha1" | "sha256" | "sha512" = "sha1",
  digits: 6 | 8 = 6,
  period = 30,
) {
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    !Number.isSafeInteger(period) ||
    period < 1 ||
    period > 300
  )
    invalid();
  const key = base32(secret).bytes,
    counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / period)));
  try {
    const digest = createHmac(algorithm, key).update(counter).digest(),
      offset = (digest.at(-1) ?? 0) & 15;
    return String(
      (digest.readUInt32BE(offset) & 0x7fff_ffff) % 10 ** digits,
    ).padStart(digits, "0");
  } finally {
    key.fill(0);
    counter.fill(0);
  }
}
export function sanitizeEnrollment(
  value: unknown,
  locator: CredentialLocator,
): Buffer {
  recordKey(locator);
  try {
    const original = object(value);
    if (original["category"] !== "LOGIN") invalid();
    const credentials = selectCredentials(value, locator.item, locator.vault);
    const fields = original["fields"];
    if (!Array.isArray(fields)) invalid();
    const otp = fields
      .map(object)
      .filter((field) => field["type"] === "OTP" || field["id"] === "otp");
    if (otp.length > 1) invalid();
    const selected: { id: string; value: string }[] = [
      { id: "username", value: credentials.email },
      { id: "password", value: credentials.password },
    ];
    if (otp.length === 1) {
      const value = otp[0]?.["value"];
      if (typeof value !== "string") invalid();
      const parsed = parseOtpSeed(value);
      selected.push({
        id: "otp",
        value: `otpauth://totp/facet?secret=${parsed.secret}&algorithm=${parsed.algorithm.toUpperCase()}&digits=6&period=${parsed.period}`,
      });
    }
    const bytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "facet-local-account",
        accountID: locator.account,
        item: {
          id: locator.item,
          vault: { id: locator.vault },
          fields: selected,
        },
      }),
    );
    if (bytes.length > maximumCredentialBytes) invalid();
    return bytes;
  } catch {
    invalid();
  }
}
export function parseLocalAccount(bytes: Buffer, locator: CredentialLocator) {
  recordKey(locator);
  try {
    if (bytes.length === 0 || bytes.length > maximumCredentialBytes) invalid();
    const envelope = object(JSON.parse(bytes.toString("utf8")));
    exactKeys(envelope, ["schemaVersion", "kind", "accountID", "item"]);
    if (
      envelope["schemaVersion"] !== 1 ||
      envelope["kind"] !== "facet-local-account" ||
      envelope["accountID"] !== locator.account
    )
      invalid();
    const item = object(envelope["item"]);
    exactKeys(item, ["id", "vault", "fields"]);
    exactKeys(object(item["vault"]), ["id"]);
    const fields = item["fields"];
    if (!Array.isArray(fields) || fields.length < 2 || fields.length > 3)
      invalid();
    for (const fieldValue of fields) {
      const field = object(fieldValue);
      exactKeys(field, ["id", "value"]);
      if (
        !["username", "password", "otp"].includes(String(field["id"])) ||
        typeof field["value"] !== "string"
      )
        invalid();
    }
    const credentials = selectCredentials(item, locator.item, locator.vault);
    const seeds = fields.map(object).filter((field) => field["id"] === "otp");
    if (seeds.length > 1) invalid();
    const seed = seeds[0]?.["value"];
    return {
      credentials,
      otp: seed === undefined ? undefined : parseOtpSeed(String(seed)),
    };
  } catch {
    invalid();
  }
}
