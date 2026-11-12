import { vi } from "vitest";
import { PromotionBrowser } from "./browser.ts";
import { PromotionTaskJournal } from "./publication/task.ts";
import { createPromotionToolHandler } from "./tools.ts";
import { promotionTarget } from "./manifest.ts";
import { memoryPromotionStore } from "./test-support.ts";
import { updatePromotionState } from "./store.ts";
import type { PromotionEmailCodeReader } from "./access/credential-input.ts";

export async function harness(
  preview = true,
  reconciliation = false,
  maxToolCalls = 80,
  login?: {
    hosts?: string[];
    otp?: string;
    readEmailCode?: PromotionEmailCodeReader;
    account?: string;
  },
) {
  const {
    readEmailCode,
    account: accountOverride,
    ...storedLogin
  } = login ?? {};
  const target = promotionTarget("pmc"),
    store = memoryPromotionStore();
  const account = accountOverride ?? target.account;
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
  vi.spyOn(browser, "hasCaptchaResponse").mockResolvedValue(false);
  const requiresCaptchaResponse = vi
    .spyOn(browser, "requiresCaptchaResponse")
    .mockResolvedValue(false);
  const controlState = vi.spyOn(browser, "controlState").mockResolvedValue({
    rendered: true,
    enabled: true,
    onScreen: true,
  });
  const preparePointer = vi
    .spyOn(browser, "preparePointer")
    .mockResolvedValue(undefined);
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
    account,
    occurrenceId: "fixture",
    preview,
    reconciliation,
    maxToolCalls,
    logins: {
      [account]: {
        username: "fixture-user",
        email: "fixture@example.invalid",
        password: "fixture-password",
        ...storedLogin,
      },
    },
    solverKey: "fixture-solver",
    solverAllowanceMicrousd: 1_000_000,
    signal: new AbortController().signal,
    heartbeat: vi.fn(),
    ...(readEmailCode === undefined ? {} : { readEmailCode }),
  });
  return {
    journal,
    handle,
    action,
    open,
    attribute,
    target,
    control,
    currentUrl,
    controlState,
    preparePointer,
    requiresCaptchaResponse,
    browser,
  };
}
