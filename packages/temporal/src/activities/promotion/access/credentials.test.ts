import { expect, it, vi } from "vitest";
import { harness } from "#activities/promotion/tool-test-support.ts";

function publishedRfcFixture(): string {
  // Public RFC 6238 Appendix B vector, not an account credential.
  const publishedVector = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const uri = new URL("otpauth://totp/fixture");
  uri.searchParams.set("secret", publishedVector);
  return uri.href;
}

it("injects a second factor privately and permits one observed verification submission", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(59_000);
  try {
    const test = await harness(true, false, 80, {
      otp: publishedRfcFixture(),
    });
    test.control.mockResolvedValue({
      ref: "e4",
      role: "textbox",
      name: "Verification code",
    });
    test.attribute.mockResolvedValue("text");
    const fill = {
      endpoint: "action",
      body: { kind: "fill", ref: "e4", credential: "otp" },
    };
    expect(await test.handle(fill)).toEqual({ filled: true });
    expect(test.action).toHaveBeenCalledWith({
      kind: "fill",
      ref: "e4",
      text: "287082",
    });
    await expect(test.handle(fill)).rejects.toThrow("already filled");
    test.control.mockResolvedValue({
      ref: "e5",
      role: "button",
      name: "Verify",
    });
    test.attribute.mockResolvedValue(null);
    const submit = {
      endpoint: "action",
      body: { kind: "click", ref: "e5", submit: true },
    };
    await test.handle(submit);
    await expect(test.handle(submit)).rejects.toThrow("already submitted");
    expect(test.action).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("refuses second-factor injection into an ordinary composer or when the seed is absent", async () => {
  const noSeed = await harness();
  await expect(
    noSeed.handle({
      endpoint: "action",
      body: { kind: "fill", ref: "e1", credential: "otp" },
    }),
  ).rejects.toThrow("second factor is unavailable");
  const test = await harness(true, false, 80, {
    otp: publishedRfcFixture(),
  });
  await expect(
    test.handle({
      endpoint: "action",
      body: { kind: "fill", ref: "e1", credential: "otp" },
    }),
  ).rejects.toThrow("matching native input");
  expect(test.action).not.toHaveBeenCalled();
});
