import { describe, expect, it, vi } from "vitest";
import { PromotionBrowser } from "./browser.ts";
import { PromotionTaskJournal } from "./task.ts";
import { createPromotionToolHandler } from "./tools.ts";
import { promotionTarget } from "./manifest.ts";
import { memoryPromotionStore } from "./test-support.ts";
import { updatePromotionState } from "./store.ts";

async function harness(
  preview = true,
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
    "fixture-token",
    { signal: new AbortController().signal },
  );
  const action = vi
    .spyOn(browser, "action")
    .mockResolvedValue({ success: true });
  const open = vi.spyOn(browser, "open").mockResolvedValue({ url: target.url });
  vi.spyOn(browser, "currentUrl").mockResolvedValue(target.url);
  const control = vi
    .spyOn(browser, "accessibleControl")
    .mockImplementation((ref) =>
      Promise.resolve(
        ref === "e3"
          ? { ref, role: "button", name: "Log In" }
          : {
              ref,
              role: "textbox",
              name: ref === "e2" ? "Password" : "Username",
            },
      ),
    );
  const attribute = vi
    .spyOn(browser, "attribute")
    .mockImplementation((ref, name) =>
      Promise.resolve(
        name === "disabled" ? null : ref === "e2" ? "password" : "text",
      ),
    );
  const journal = new PromotionTaskJournal({
    target,
    store,
    occurrenceId: "fixture",
    mode: reconciliation ? "reconcile" : preview ? "preview" : "run",
    enabled: () => Promise.resolve(true),
    now: Date.now,
    capture: vi.fn(),
  });
  const handle = createPromotionToolHandler({
    browser,
    journal,
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
        email: "fixture@example.invalid",
        password: "fixture-password",
      },
    },
    solverKey: "fixture-solver",
    solverAllowanceMicrousd: 1_000_000,
    signal: new AbortController().signal,
    heartbeat: vi.fn(),
  });
  return { handle, action, open, attribute, target, control };
}

describe("native browser connection", () => {
  it("injects the saved alternate email privately when the observed form requests it", async () => {
    const test = await harness();
    expect(
      await test.handle({
        endpoint: "action",
        body: { kind: "fill", ref: "e1", credential: "email" },
      }),
    ).toEqual({ filled: true });
    expect(test.action).toHaveBeenCalledWith({
      kind: "fill",
      ref: "e1",
      text: "fixture@example.invalid",
    });
  });
  it.each(["Sign In →", "Log In to your account"])(
    "allows the observed sign-in label %s once",
    async (name) => {
      const test = await harness();
      await test.handle({
        endpoint: "action",
        body: { kind: "fill", ref: "e2", credential: "password" },
      });
      test.control.mockResolvedValue({
        ref: "e3",
        role: "button",
        name,
      });
      await test.handle({
        endpoint: "action",
        body: { kind: "click", ref: "e3" },
      });
      expect(test.action).toHaveBeenLastCalledWith({
        kind: "click",
        ref: "e3",
      });
    },
  );
  it("blocks a combined login and publication control", async () => {
    const test = await harness();
    await test.handle({
      endpoint: "action",
      body: { kind: "fill", ref: "e2", credential: "password" },
    });
    test.action.mockClear();
    test.control.mockResolvedValue({
      ref: "e3",
      role: "button",
      name: "Sign In and Bump",
    });
    await expect(
      test.handle({ endpoint: "action", body: { kind: "click", ref: "e3" } }),
    ).rejects.toThrow("Read-only");
    expect(test.action).not.toHaveBeenCalled();
  });
  it.each([
    { type: "search", role: null, label: null },
    { type: "text", role: "searchbox", label: null },
    { type: null, role: "combobox", label: "Search" },
  ])(
    "permits native read-only search without enabling message composers: %j",
    async (attrs) => {
      const test = await harness();
      test.attribute.mockImplementation((_ref, name) =>
        Promise.resolve(
          name === "type"
            ? attrs.type
            : name === "role"
              ? attrs.role
              : attrs.label,
        ),
      );
      await test.handle({
        endpoint: "action",
        body: { kind: "fill", ref: "e1", text: "from:the.storm.mc" },
      });
      await test.handle({
        endpoint: "action",
        body: { kind: "press", ref: "e1", key: "Enter" },
      });
      expect(test.action).toHaveBeenCalledTimes(2);
      test.attribute.mockImplementation((_ref, name) =>
        Promise.resolve(name === "role" ? "textbox" : null),
      );
      await expect(
        test.handle({
          endpoint: "action",
          body: { kind: "fill", ref: "e1", text: "Ad copy" },
        }),
      ).rejects.toThrow("Read-only");
      expect(test.action).toHaveBeenCalledTimes(2);
    },
  );
  it("serializes overlapping commands without losing either request", async () => {
    const test = await harness();
    const gate = Promise.withResolvers<{ success: boolean }>();
    test.action.mockReturnValueOnce(gate.promise);
    const first = test.handle({
      endpoint: "action",
      body: { kind: "scroll", scrollY: 100 },
    });
    const second = test.handle({
      endpoint: "action",
      body: { kind: "scroll", scrollY: 200 },
    });
    await vi.waitFor(() => expect(test.action).toHaveBeenCalledTimes(1));
    gate.resolve({ success: true });
    await Promise.all([first, second]);
    expect(test.action.mock.calls.map(([body]) => body["scrollY"])).toEqual([
      100, 200,
    ]);
  });
});

describe("credential isolation and preview restrictions", () => {
  it("lets the agent choose input refs and injects credentials without exposing values", async () => {
    const test = await harness();
    expect(
      await test.handle({
        endpoint: "action",
        body: { kind: "fill", ref: "e1", credential: "username" },
      }),
    ).toEqual({ filled: true });
    await test.handle({
      endpoint: "action",
      body: { kind: "fill", ref: "e2", credential: "password" },
    });
    await test.handle({
      endpoint: "action",
      body: { kind: "click", ref: "e3" },
    });
    expect(test.action.mock.calls).toEqual([
      [{ kind: "fill", ref: "e1", text: "fixture-user" }],
      [{ kind: "fill", ref: "e2", text: "fixture-password" }],
      [{ kind: "click", ref: "e3" }],
    ]);
    await expect(
      test.handle({ endpoint: "action", body: { kind: "click", ref: "e3" } }),
    ).rejects.toThrow("already submitted");
  });
  it("refuses password injection into an ordinary input", async () => {
    const test = await harness();
    await expect(
      test.handle({
        endpoint: "action",
        body: { kind: "fill", ref: "e1", credential: "password" },
      }),
    ).rejects.toThrow("matching native input");
    expect(test.action).not.toHaveBeenCalled();
  });
  it("supports native credential typing and repairs a disabled form before the one submission", async () => {
    const test = await harness();
    await test.handle({
      endpoint: "action",
      body: { kind: "type", ref: "e2", credential: "password" },
    });
    expect(test.action.mock.calls).toEqual([
      [{ kind: "fill", ref: "e2", text: "" }],
      [{ kind: "type", ref: "e2", text: "fixture-password" }],
    ]);
    test.attribute.mockResolvedValueOnce("");
    const click = { endpoint: "action", body: { kind: "click", ref: "e3" } };
    await expect(test.handle(click)).rejects.toThrow("disabled");
    await test.handle(click);
    await expect(test.handle(click)).rejects.toThrow("already submitted");
  });
  it("never repeats an ambiguous login submission", async () => {
    const test = await harness();
    await test.handle({
      endpoint: "action",
      body: { kind: "fill", ref: "e2", credential: "password" },
    });
    test.action.mockRejectedValueOnce(new Error("Connection closed"));
    const click = { endpoint: "action", body: { kind: "click", ref: "e3" } };
    await expect(test.handle(click)).rejects.toThrow("Connection closed");
    await expect(test.handle(click)).rejects.toThrow("already submitted");
  });
  it.each([
    { endpoint: "action", body: { kind: "fill", ref: "e1", text: "Ad copy" } },
    { endpoint: "action", body: { kind: "press", ref: "e1", key: "Enter" } },
    { endpoint: "action", body: { kind: "click", selector: "#submit" } },
    {
      endpoint: "navigate",
      body: { url: "https://www.planetminecraft.com/bump/123" },
    },
  ])("blocks a possible publication in preview: %j", async (command) => {
    const test = await harness();
    await expect(test.handle(command)).rejects.toThrow("Read-only");
    expect(test.action).not.toHaveBeenCalled();
    expect(test.open).not.toHaveBeenCalled();
  });
  it("keeps raw credentials, eval, and paid solving out of preview", async () => {
    const test = await harness();
    await expect(
      test.handle({
        endpoint: "attr",
        body: { selector: "e2", name: "value" },
      }),
    ).rejects.toThrow();
    await expect(
      test.handle({
        endpoint: "evaluate",
        body: { expression: "document.cookie" },
      }),
    ).rejects.toThrow();
    await expect(test.handle({ endpoint: "solve-captcha" })).rejects.toThrow(
      "Read-only",
    );
    expect(test.attribute).not.toHaveBeenCalled();
  });
  it("rejects conflicting targets before a login reference can authorize another control", async () => {
    const test = await harness();
    await test.handle({
      endpoint: "action",
      body: { kind: "fill", ref: "e2", credential: "password" },
    });
    test.action.mockClear();
    await expect(
      test.handle({
        endpoint: "action",
        body: { kind: "click", ref: "e3", selector: "#submit" },
      }),
    ).rejects.toThrow("never both");
    expect(test.action).not.toHaveBeenCalled();
  });
  it("allows normal scrolling and enforces a total tool budget", async () => {
    const test = await harness(true, false, 1);
    await test.handle({
      endpoint: "action",
      body: { kind: "scroll", scrollY: 500 },
    });
    await expect(test.handle({ endpoint: "snapshot" })).rejects.toThrow(
      "budget",
    );
    expect(test.action).toHaveBeenCalledOnce();
  });
  it("never signs in during reconciliation", async () => {
    const test = await harness(false, true);
    await expect(
      test.handle({
        endpoint: "action",
        body: { kind: "fill", ref: "e2", credential: "password" },
      }),
    ).rejects.toThrow("never signs in");
  });
});
