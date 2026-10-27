import { vi } from "vitest";
import { PromotionBrowser } from "./browser.ts";
import { PromotionTaskJournal } from "./task.ts";
import { createPromotionToolHandler } from "./tools.ts";
import { promotionTarget } from "./manifest.ts";
import { memoryPromotionStore } from "./test-support.ts";
import { updatePromotionState } from "./store.ts";

export async function harness(
  preview = true,
  reconciliation = false,
  maxToolCalls = 80,
  login?: { hosts?: string[]; otp?: string },
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
  const currentUrl = vi
    .spyOn(browser, "currentUrl")
    .mockResolvedValue(target.url);
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
        ...login,
      },
    },
    solverKey: "fixture-solver",
    solverAllowanceMicrousd: 1_000_000,
    signal: new AbortController().signal,
    heartbeat: vi.fn(),
  });
  return {
    handle,
    action,
    open,
    attribute,
    target,
    control,
    currentUrl,
    browser,
  };
}
