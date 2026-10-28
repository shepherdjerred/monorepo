import { expect, test } from "vitest";
import {
  generateTotp,
  parseLocalAccount,
  parseOtpSeed,
  recordKey,
  sanitizeEnrollment,
} from "./payload.ts";

const locator = {
  account: "A".repeat(26),
  vault: "b".repeat(26),
  item: "c".repeat(26),
};
const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const source = () => ({
  category: "LOGIN",
  id: locator.item,
  vault: { id: locator.vault },
  notesPlain: "not copied",
  fields: [
    { id: "username", value: "synthetic@example.invalid" },
    { id: "password", value: "synthetic-only-password" },
    {
      id: "TOTP_example",
      type: "OTP",
      value: `otpauth://totp/private-label?secret=${seed}&issuer=private-issuer`,
    },
    { id: "unrelated", value: "not copied" },
  ],
});

test("local enrollment retains only bound username/password and optional normalized OTP seed", () => {
  const bytes = sanitizeEnrollment(source(), locator);
  expect(bytes.toString()).not.toContain("not copied");
  expect(bytes.toString()).not.toContain("private-label");
  expect(bytes.toString()).not.toContain("private-issuer");
  expect(parseLocalAccount(bytes, locator)).toEqual({
    credentials: {
      email: "synthetic@example.invalid",
      password: "synthetic-only-password",
    },
    otp: { secret: seed, algorithm: "sha1", digits: 6, period: 30 },
  });
  for (const foreign of [
    { ...locator, account: "Z".repeat(26) },
    { ...locator, vault: "Z".repeat(26) },
    { ...locator, item: "Z".repeat(26) },
  ])
    expect(() => parseLocalAccount(bytes, foreign)).toThrow(
      "local_credentials_invalid_payload",
    );
  const unknown = JSON.parse(bytes.toString());
  unknown.extra = "synthetic-secret";
  expect(() =>
    parseLocalAccount(Buffer.from(JSON.stringify(unknown)), locator),
  ).toThrow("local_credentials_invalid_payload");
});

test("malformed, concealed, duplicate or non-login items cannot be enrolled", () => {
  for (const alter of [
    (item: ReturnType<typeof source>) => {
      item.category = "SECURE_NOTE";
    },
    (item: ReturnType<typeof source>) => {
      item.id = "other";
    },
    (item: ReturnType<typeof source>) => {
      item.vault.id = "other";
    },
    (item: ReturnType<typeof source>) => {
      item.fields.push({ id: "password", value: "duplicate" });
    },
    (item: ReturnType<typeof source>) => {
      item.fields[1] = { id: "password", value: "********" };
    },
    (item: ReturnType<typeof source>) => {
      item.fields.push({ id: "second", type: "OTP", value: seed });
    },
  ]) {
    const item = source();
    alter(item);
    expect(() => sanitizeEnrollment(item, locator)).toThrow(
      "local_credentials_invalid_payload",
    );
  }
  expect(() => recordKey({ ...locator, item: "invalid:foreign" })).toThrow();
  expect(() => parseLocalAccount(Buffer.alloc(65_537), locator)).toThrow(
    "local_credentials_invalid_payload",
  );
  const noOtp = source();
  noOtp.fields = noOtp.fields.filter((field) => field.type !== "OTP");
  expect(
    parseLocalAccount(sanitizeEnrollment(noOtp, locator), locator).otp,
  ).toBeUndefined();
});

test.each([
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
] as const)("RFC6238 SHA1 vector at%s", (seconds, expected) => {
  expect(generateTotp(seed, seconds, "sha1", 8)).toBe(expected);
  expect(generateTotp(seed, seconds)).toBe(expected.slice(-6));
});

test("OTP parsers reject unsupported/ambiguous seeds rather than requesting interactive fallback", () => {
  for (const value of [
    "otpauth://hotp/facet?secret=" + seed,
    `otpauth://totp/facet?secret=${seed}&secret=${seed}`,
    `otpauth://totp/facet?secret=${seed}&digits=8`,
    `otpauth://totp/facet?secret=${seed}&period=0`,
    `otpauth://totp/facet?secret=${seed}&algorithm=MD5`,
    "********",
    "short",
    seed + "!",
  ])
    expect(() => parseOtpSeed(value)).toThrow(
      "local_credentials_invalid_payload",
    );
});

test.each([
  [
    "sha256",
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA",
    "46119246",
  ],
  [
    "sha512",
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA",
    "90693936",
  ],
] as const)(
  "RFC6238 %s vector and enrollment algorithm contract",
  (algorithm, secret, expected) => {
    expect(generateTotp(secret, 59, algorithm, 8)).toBe(expected);
    expect(
      parseOtpSeed(
        `otpauth://totp/facet?secret=${secret}&algorithm=${algorithm.toUpperCase()}`,
      ).algorithm,
    ).toBe(algorithm);
  },
);
