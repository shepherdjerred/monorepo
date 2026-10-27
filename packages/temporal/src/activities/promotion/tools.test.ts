import { describe, expect, it, vi } from "vitest";
import { harness } from "./tool-test-support.ts";

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
      await expect(
        test.handle({
          endpoint: "action",
          body: { kind: "click", ref: "e3", waitNav: true, submit: true },
        }),
      ).rejects.toThrow("Choose submit or waitNav");
      await test.handle({
        endpoint: "action",
        body: { kind: "click", ref: "e3", submit: true },
      });
      expect(test.action).toHaveBeenLastCalledWith({
        kind: "click",
        ref: "e3",
        submit: true,
      });
    },
  );
  it.each([
    "Sign In and Bump",
    "Log in and reply",
    "Sign in & submit",
    "Sign in and send",
    "Sign in to comment",
  ])("blocks a combined login and publication control: %s", async (name) => {
    const test = await harness();
    await test.handle({
      endpoint: "action",
      body: { kind: "fill", ref: "e2", credential: "password" },
    });
    test.action.mockClear();
    test.control.mockResolvedValue({
      ref: "e3",
      role: "button",
      name,
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

describe("scoped credentials and preview disclosures", () => {
  it("keeps SSO credentials on the assigned identity host", async () => {
    const test = await harness(true, false, 80, {
      hosts: ["accounts.google.com"],
    });
    const command = {
      endpoint: "action",
      body: { kind: "fill", ref: "e2", credential: "password" },
    };
    await expect(test.handle(command)).rejects.toThrow("host");
    expect(test.action).not.toHaveBeenCalled();
    test.currentUrl.mockResolvedValue("https://accounts.google.com/signin/");
    await expect(test.handle(command)).resolves.toEqual({ filled: true });
    expect(test.action).toHaveBeenCalledTimes(1);
  });
  it.each([
    {
      role: "button",
      name: "Account",
      type: "button",
      popup: "menu",
      expanded: null,
    },
    {
      role: "button",
      name: "Manage listing",
      type: "button",
      popup: null,
      expanded: "false",
    },
    { role: "tab", name: "Overview", type: null, popup: null, expanded: null },
  ])("opens an observed preview disclosure: %j", async (node) => {
    const test = await harness();
    test.control.mockResolvedValue({
      ref: "e4",
      role: node.role,
      name: node.name,
    });
    test.attribute.mockImplementation((_ref, name) =>
      Promise.resolve(
        name === "type"
          ? node.type
          : name === "aria-haspopup"
            ? node.popup
            : node.expanded,
      ),
    );
    await test.handle({
      endpoint: "action",
      body: { kind: "click", ref: "e4" },
    });
    expect(test.action).toHaveBeenCalledWith({ kind: "click", ref: "e4" });
  });
  it.each([
    { name: "Account", type: "submit" },
    { name: "Reset", type: "reset" },
    { name: "Bump server", type: "button" },
    { name: "Send message", type: "button" },
    { name: "Accept rules", type: "button" },
  ])("blocks effects disguised as disclosures: %j", async (node) => {
    const test = await harness();
    test.control.mockResolvedValue({
      ref: "e4",
      role: "button",
      name: node.name,
    });
    test.attribute.mockImplementation((_ref, name) =>
      Promise.resolve(name === "type" ? node.type : "true"),
    );
    await expect(
      test.handle({ endpoint: "action", body: { kind: "click", ref: "e4" } }),
    ).rejects.toThrow("Read-only");
    expect(test.action).not.toHaveBeenCalled();
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
      endpoint: "action",
      body: { kind: "click", selector: "#submit", submit: true },
    },
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
  it("keeps raw credentials and eval out of preview, and solving out of reconciliation", async () => {
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
    const reconciliation = await harness(true, true);
    await expect(
      reconciliation.handle({ endpoint: "solve-captcha" }),
    ).rejects.toThrow("Read-only");
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

describe("preview access CAPTCHA solving", () => {
  it("solves under budget while publication controls remain blocked", async () => {
    vi.useFakeTimers();
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ errorId: 0, taskId: 123 }))
      .mockResolvedValue(
        Response.json({
          errorId: 0,
          status: "ready",
          cost: 0.002,
          solution: { token: "fixture-response" },
        }),
      );
    try {
      const test = await harness();
      vi.spyOn(test.browser, "challenge").mockResolvedValue({
        type: "TurnstileTaskProxyless",
        websiteURL: test.target.url,
        websiteKey: "fixture-key",
      });
      const apply = vi
        .spyOn(test.browser, "applyChallenge")
        .mockResolvedValue(undefined);
      const result = test.handle({ endpoint: "solve-captcha" });
      await vi.runAllTimersAsync();
      expect(await result).toMatchObject({ taskId: 123, costMicrousd: 2000 });
      expect(apply).toHaveBeenCalledWith("fixture-response");
      expect(test.action).not.toHaveBeenCalled();
      await expect(
        test.handle({
          endpoint: "action",
          body: { kind: "click", selector: "#submit" },
        }),
      ).rejects.toThrow("Read-only");
    } finally {
      request.mockRestore();
      vi.useRealTimers();
    }
  });
});
