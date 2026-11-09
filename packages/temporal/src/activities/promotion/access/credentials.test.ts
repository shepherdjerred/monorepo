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
  noSeed.control.mockResolvedValue({
    ref: "e1",
    role: "textbox",
    name: "Verification code",
  });
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

it("fills a private email code and permits one observed confirmation", async () => {
  const reader = vi.fn().mockResolvedValue("123456");
  const test = await harness(true, false, 80, {
    readEmailCode: reader,
    account: "builtbybit",
    hosts: ["builtbybit.com"],
  });
  test.currentUrl.mockResolvedValue("https://builtbybit.com/login/two-step");
  test.control.mockResolvedValue({
    ref: "e4",
    role: "textbox",
    name: "Email confirmation code",
  });
  test.attribute.mockResolvedValue("text");
  const fill = {
    endpoint: "action",
    body: { kind: "fill", ref: "e4", credential: "email-code" },
  };
  expect(await test.handle(fill)).toEqual({ filled: true });
  expect(reader).toHaveBeenCalledWith(
    expect.objectContaining({
      account: "builtbybit",
      recipient: "fixture@example.invalid",
    }),
  );
  expect(test.action).toHaveBeenCalledWith({
    kind: "fill",
    ref: "e4",
    text: "123456",
  });
  await expect(test.handle(fill)).rejects.toThrow("already filled");
  test.control.mockResolvedValue({
    ref: "e5",
    role: "button",
    name: "\u{F023} Confirm",
  });
  test.attribute.mockResolvedValue(null);
  const confirm = {
    endpoint: "action",
    body: { kind: "click", ref: "e5", submit: true },
  };
  await test.handle(confirm);
  await expect(test.handle(confirm)).rejects.toThrow("already submitted");
  expect(reader).toHaveBeenCalledOnce();
  expect(test.action).toHaveBeenCalledTimes(2);
});

it("never reads mail for an ordinary input or without the explicit capability", async () => {
  const reader = vi.fn();
  const test = await harness(true, false, 80, { readEmailCode: reader });
  const fill = {
    endpoint: "action",
    body: { kind: "fill", ref: "e1", credential: "email-code" },
  };
  await expect(test.handle(fill)).rejects.toThrow("matching native input");
  expect(reader).not.toHaveBeenCalled();
  const missing = await harness(true, false, 80, {
    account: "builtbybit",
    hosts: ["builtbybit.com"],
  });
  missing.currentUrl.mockResolvedValue("https://builtbybit.com/login/two-step");
  missing.control.mockResolvedValue({
    ref: "e1",
    role: "textbox",
    name: "Email confirmation code",
  });
  await expect(missing.handle(fill)).rejects.toThrow("not enabled");
  const wrongPage = await harness(true, false, 80, {
    account: "builtbybit",
    readEmailCode: reader,
    hosts: ["builtbybit.com"],
  });
  wrongPage.currentUrl.mockResolvedValue(
    "https://builtbybit.com/threads/743099/",
  );
  wrongPage.control.mockResolvedValue({
    ref: "e1",
    role: "textbox",
    name: "Email confirmation code",
  });
  await expect(wrongPage.handle(fill)).rejects.toThrow("restricted");
  expect(reader).not.toHaveBeenCalled();
});

it("does not permit another authenticator fill after navigation", async () => {
  const test = await harness(true, false, 80, { otp: publishedRfcFixture() });
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
  await test.handle(fill);
  await test.handle({ endpoint: "navigate", body: { url: test.target.url } });
  await expect(test.handle(fill)).rejects.toThrow("already filled");
  expect(test.action).toHaveBeenCalledTimes(1);
});

it("permits one credential-bound Google identifier step and one password step", async () => {
  const test = await harness(true, false, 80, {
    hosts: ["accounts.google.com"],
  });
  test.currentUrl.mockResolvedValue(
    "https://accounts.google.com/v3/signin/identifier",
  );
  await test.handle({
    endpoint: "action",
    body: { kind: "fill", ref: "e1", credential: "username" },
  });
  test.control.mockResolvedValue({ ref: "e3", role: "button", name: "Next" });
  const next = {
    endpoint: "action",
    body: { kind: "click", ref: "e3", waitNav: true },
  };
  await test.handle(next);
  await expect(test.handle(next)).rejects.toThrow("already submitted");
  test.currentUrl.mockResolvedValue(
    "https://accounts.google.com/v3/signin/challenge/pwd",
  );
  test.control.mockResolvedValue({
    ref: "e2",
    role: "textbox",
    name: "Enter your password",
  });
  await test.handle({
    endpoint: "action",
    body: { kind: "fill", ref: "e2", credential: "password" },
  });
  test.control.mockResolvedValue({ ref: "e3", role: "button", name: "Next" });
  await test.handle(next);
  await expect(test.handle(next)).rejects.toThrow("already submitted");
  expect(test.action).toHaveBeenCalledTimes(4);
});

it("rejects Next without a private credential and outside the assigned provider", async () => {
  const provider = await harness(true, false, 80, {
    hosts: ["accounts.google.com"],
  });
  provider.currentUrl.mockResolvedValue(
    "https://accounts.google.com/v3/signin/identifier",
  );
  provider.control.mockResolvedValue({
    ref: "e3",
    role: "button",
    name: "Next",
  });
  await expect(
    provider.handle({ endpoint: "action", body: { kind: "click", ref: "e3" } }),
  ).rejects.toThrow("Fill the stored password");
  expect(provider.action).not.toHaveBeenCalled();
  const ordinary = await harness();
  await ordinary.handle({
    endpoint: "action",
    body: { kind: "fill", ref: "e1", credential: "username" },
  });
  ordinary.control.mockResolvedValue({
    ref: "e3",
    role: "button",
    name: "Next",
  });
  await expect(
    ordinary.handle({ endpoint: "action", body: { kind: "click", ref: "e3" } }),
  ).rejects.toThrow("Read-only mode");
  expect(ordinary.action).toHaveBeenCalledTimes(1);
});
