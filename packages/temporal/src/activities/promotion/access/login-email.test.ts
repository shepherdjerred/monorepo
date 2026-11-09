import { it, expect } from "vitest";
import { promotionLoginEmail } from "./login-email.ts";
it("keeps default email with partial field overrides", () => {
  expect(
    promotionLoginEmail(
      [{ label: "email", value: "fixture@example.com" }],
      undefined,
    ),
  ).toBe("fixture@example.com");
});
it("honors explicit email mapping", () => {
  expect(
    promotionLoginEmail(
      [{ label: "alternate", value: "fixture@example.com" }],
      "alternate",
    ),
  ).toBe("fixture@example.com");
});
it("rejects missing or malformed mapped email", () => {
  expect(() => promotionLoginEmail([], "email")).toThrow("Mapped email");
  expect(() =>
    promotionLoginEmail([{ label: "email", value: "invalid" }], "email"),
  ).toThrow("Mapped email");
});
it("permits absent optional email", () => {
  expect(promotionLoginEmail([])).toBeUndefined();
});
