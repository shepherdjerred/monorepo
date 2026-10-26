import { describe, expect, it, vi } from "vitest";
import { PromotionBrowser } from "./browser.ts";
import { PromotionGateway } from "./gateway.ts";
import { promotionTarget } from "./manifest.ts";
import { memoryPromotionStore } from "./test-support.ts";
import { updatePromotionState } from "./store.ts";
import { createPromotionToolHandler } from "./tools.ts";

async function harness(
  preview: boolean,
  reconciliation = false,
  maxToolCalls = 80,
) {
  const target = promotionTarget("pmc"),
    store = memoryPromotionStore();
  await updatePromotionState(store, target.id, (state) => ({
    ...state,
    lock: { occurrenceId: "fixture", acquiredAt: new Date().toISOString() },
  }));
  const browser = new PromotionBrowser(
    target,
    "http://browser.invalid",
    "fixture-browser-key",
    new AbortController().signal,
  );
  const open = vi.spyOn(browser, "open").mockResolvedValue({ url: target.url });
  const login = vi.spyOn(browser, "login").mockResolvedValue(undefined);
  const gateway = new PromotionGateway({
    store,
    target,
    occurrenceId: "fixture",
    preview,
    now: Date.now,
    enabled: () => Promise.resolve(true),
    submit: vi.fn(),
    capture: vi.fn(),
  });
  const handle = createPromotionToolHandler({
    browser,
    gateway,
    store,
    targetId: target.id,
    account: target.account,
    occurrenceId: "fixture",
    preview,
    reconciliation,
    maxToolCalls,
    logins: {
      [target.account]: {
        username: "fixture-user",
        password: "fixture-password",
      },
    },
    solverKey: "fixture-solver-key",
    solverAllowanceMicrousd: 10_000_000,
    signal: new AbortController().signal,
    heartbeat: vi.fn(),
  });
  return { handle, open, login, target };
}

describe("promotion tool authority", () => {
  it.each([true, false])(
    "uses stored credentials once in preview=%s without returning their values",
    async (preview) => {
      const test = await harness(preview);
      const command = {
        operation: "login",
        usernameSelector: "#email",
        passwordSelector: "#password",
        submitSelector: "#login",
      };
      expect(await test.handle(command)).toEqual({ loginAttempted: true });
      expect(test.login).toHaveBeenCalledWith(
        expect.objectContaining({
          username: "fixture-user",
          password: "fixture-password",
        }),
      );
      await expect(test.handle(command)).rejects.toThrow(
        "already attempted login",
      );
      expect(test.login).toHaveBeenCalledOnce();
    },
  );
  it("does not retry an ambiguous login failure", async () => {
    const test = await harness(true);
    test.login.mockRejectedValueOnce(
      new Error("Browser connection closed after login"),
    );
    const command = {
      operation: "login",
      usernameSelector: "#email",
      passwordSelector: "#password",
      submitSelector: "#login",
    };
    await expect(test.handle(command)).rejects.toThrow("connection closed");
    await expect(test.handle(command)).rejects.toThrow(
      "already attempted login",
    );
    expect(test.login).toHaveBeenCalledOnce();
  });
  it("blocks publishing, settlement and paid solving in preview outside the model prompt", async () => {
    const test = await harness(true);
    for (const command of [
      { operation: "publish", selector: "#bump", content: "Native bump" },
      {
        operation: "verify",
        status: "verified",
        receiptUrl: test.target.url,
        quote: "Bumped successfully",
      },
      { operation: "solve-captcha" },
    ])
      await expect(test.handle(command)).rejects.toThrow("Preview cannot");
    expect(test.open).not.toHaveBeenCalled();
  });
  it("allows reconciliation reads and refuses new form actions", async () => {
    const test = await harness(false, true);
    await test.handle({ operation: "open", url: test.target.url });
    expect(test.open).toHaveBeenCalledOnce();
    await expect(
      test.handle({ operation: "fill", selector: "#text", text: "New post" }),
    ).rejects.toThrow("Reconciliation allows");
    await expect(test.handle({ operation: "solve-captcha" })).rejects.toThrow(
      "Reconciliation allows",
    );
  });
  it("enforces a total browser-tool budget even across multiple model shell commands", async () => {
    const test = await harness(true, false, 1);
    await test.handle({ operation: "open", url: test.target.url });
    await expect(
      test.handle({ operation: "open", url: test.target.url }),
    ).rejects.toThrow("budget exhausted");
    expect(test.open).toHaveBeenCalledOnce();
  });
});
