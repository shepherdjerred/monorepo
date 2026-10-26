import { z } from "zod/v4";
import { PromotionPreflightSchema } from "#shared/promotion.ts";
import type { PromotionBrowser } from "./browser.ts";
import type { PromotionGateway } from "./gateway.ts";
import {
  assertPromotionOwnership,
  readPromotionState,
  type PromotionStore,
} from "./store.ts";
import { solvePromotionChallenge } from "./solver.ts";

export const PromotionToolSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("open"), url: z.url() }),
  z.strictObject({ operation: z.literal("snapshot") }),
  z.strictObject({ operation: z.literal("link"), selector: z.string().min(1) }),
  z.strictObject({
    operation: z.literal("fill"),
    selector: z.string().min(1),
    text: z.string().max(30_000),
  }),
  z.strictObject({
    operation: z.literal("login"),
    usernameSelector: z.string(),
    passwordSelector: z.string(),
    submitSelector: z.string(),
  }),
  z.strictObject({
    operation: z.literal("preflight"),
    evidence: PromotionPreflightSchema,
  }),
  z.strictObject({
    operation: z.literal("publish"),
    selector: z.string().min(1),
    content: z.string().max(30_000),
  }),
  z.strictObject({
    operation: z.literal("verify"),
    status: z.enum(["verified", "filtered", "rejected"]),
    receiptUrl: z.url(),
    quote: z.string().min(5),
    occurrenceId: z.string().optional(),
  }),
  z.strictObject({ operation: z.literal("solve-captcha") }),
]);

export const PromotionLoginsSchema = z.record(
  z.string(),
  z.strictObject({ username: z.string().min(1), password: z.string().min(1) }),
);

export function createPromotionToolHandler(input: {
  browser: PromotionBrowser;
  gateway: PromotionGateway;
  store: PromotionStore;
  targetId: string;
  account: string;
  occurrenceId: string;
  reconciliation: boolean;
  preview: boolean;
  maxToolCalls: number;
  logins: z.infer<typeof PromotionLoginsSchema>;
  solverKey: string;
  solverAllowanceMicrousd: number;
  signal: AbortSignal;
  heartbeat: () => void;
}) {
  let inFlight = false;
  let toolCalls = 0;
  let loginAttempted = false;
  function checkBudget() {
    if (++toolCalls > input.maxToolCalls)
      throw new Error("Promotion browser tool budget exhausted");
  }
  async function loginOnce(
    tool: Extract<z.infer<typeof PromotionToolSchema>, { operation: "login" }>,
  ) {
    if (loginAttempted)
      throw new Error(
        "This occurrence already attempted login; inspect the result instead of retrying",
      );
    const login = input.logins[input.account];
    if (login === undefined)
      throw new Error(
        "Login unavailable; authenticate this target's persistent browser profile",
      );
    loginAttempted = true;
    await input.browser.login({ ...login, ...tool });
    return { loginAttempted: true };
  }
  return async (raw: unknown): Promise<unknown> => {
    if (inFlight) throw new Error("Promotion tool calls must be sequential");
    if (input.signal.aborted) throw new Error("Promotion run cancelled");
    inFlight = true;
    try {
      const tool = PromotionToolSchema.parse(raw);
      checkBudget();
      if (
        input.preview &&
        ["publish", "verify", "solve-captcha"].includes(tool.operation)
      )
        throw new Error(
          "Preview cannot publish, settle receipts or create paid CAPTCHA tasks",
        );
      const state = await readPromotionState(input.store, input.targetId);
      assertPromotionOwnership(state, input.occurrenceId);
      input.heartbeat();
      if (tool.operation === "open") return await input.browser.open(tool.url);
      if (tool.operation === "snapshot") {
        const page = await input.browser.snapshot();
        return {
          untrustedPageContent: input.gateway.observe(page.url, page.text),
        };
      }
      if (tool.operation === "link")
        return await input.browser.navigateLink(tool.selector);
      if (tool.operation === "preflight")
        return await input.gateway.preflight(tool.evidence);
      if (tool.operation === "verify") return await input.gateway.verify(tool);
      if (input.reconciliation)
        throw new Error(
          "Reconciliation allows observations and receipt verification only",
        );
      if (tool.operation === "fill") {
        await input.browser.fill(tool.selector, tool.text);
        return { filled: true };
      }
      if (tool.operation === "publish")
        return await input.gateway.publish(tool.selector, tool.content);
      if (tool.operation === "login") return await loginOnce(tool);
      return await solvePromotionChallenge({
        store: input.store,
        occurrenceId: input.occurrenceId,
        challenge: await input.browser.challenge(),
        apiKey: input.solverKey,
        allowanceMicrousd: input.solverAllowanceMicrousd,
        signal: input.signal,
        heartbeat: input.heartbeat,
        apply: (token) => input.browser.applyChallenge(token),
      });
    } finally {
      inFlight = false;
    }
  };
}
