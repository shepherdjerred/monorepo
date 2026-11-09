import { expect, it } from "vitest";
import { promotionTotp } from "./otp.ts";

it.each([
  [59, "94287082"],
  [1_111_111_109, "07081804"],
  [1_111_111_111, "14050471"],
  [1_234_567_890, "89005924"],
] as const)("matches the RFC 6238 SHA1 vector at %s", (seconds, expected) => {
  expect(
    promotionTotp(
      "otpauth://totp/fixture?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8",
      seconds * 1000,
    ),
  ).toBe(expected);
});
it("rejects unsupported or corrupt second-factor metadata", () => {
  expect(() => promotionTotp("otpauth://hotp/fixture?secret=GEZDGNBV")).toThrow(
    "TOTP",
  );
  expect(() =>
    promotionTotp("otpauth://totp/fixture?secret=wrong!key"),
  ).toThrow();
});
