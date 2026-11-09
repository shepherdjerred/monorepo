import { createHmac } from "node:crypto";
import { z } from "zod/v4";

/** RFC 6238; the seed and generated code remain in the credential-owning parent. */
export function promotionTotp(uri: string, now = Date.now()): string {
  const url = new URL(uri);
  if (url.protocol !== "otpauth:" || url.hostname !== "totp")
    throw new Error("Stored second factor must be a TOTP otpauth URI");
  const secret = z
    .string()
    .regex(/^[A-Z2-7]+=*$/i)
    .parse(url.searchParams.get("secret"));
  const digits = z.coerce
    .number()
    .int()
    .min(6)
    .max(8)
    .parse(url.searchParams.get("digits") ?? "6");
  const period = z.coerce
    .number()
    .int()
    .min(1)
    .parse(url.searchParams.get("period") ?? "30");
  const algorithm = z
    .enum(["SHA1", "SHA256", "SHA512"])
    .parse(url.searchParams.get("algorithm") ?? "SHA1");
  let bits = "";
  for (const character of secret.toUpperCase().replace(/=+$/, "")) {
    const point = character.codePointAt(0);
    if (point === undefined)
      throw new Error("TOTP seed contains an empty character");
    const digit = point >= 65 && point <= 90 ? point - 65 : point - 50 + 26;
    bits += digit.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8)
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  if (bytes.length < 10)
    throw new Error("Stored second-factor seed is too short");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const hash = createHmac(algorithm.toLowerCase(), Buffer.from(bytes))
    .update(counter)
    .digest();
  const last = hash.at(-1);
  if (last === undefined) throw new Error("TOTP digest is empty");
  const offset = last & 15;
  const code = hash.readUInt32BE(offset) & 0x7f_ff_ff_ff;
  return String(code % 10 ** digits).padStart(digits, "0");
}
