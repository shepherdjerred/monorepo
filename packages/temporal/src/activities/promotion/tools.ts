import { z } from "zod/v4";
import type { PromotionBrowser } from "./browser.ts";
import type { PromotionTaskJournal } from "./task.ts";
import {
  assertPromotionOwnership,
  readPromotionState,
  type PromotionStore,
} from "./store.ts";
import { solvePromotionChallenge } from "./solver.ts";

const ActionSchema = z
  .strictObject({
    kind: z.enum([
      "click",
      "fill",
      "type",
      "select",
      "press",
      "scroll",
      "hover",
    ]),
    ref: z
      .string()
      .regex(/^e\d+$/)
      .optional(),
    selector: z.string().min(1).optional(),
    text: z.string().max(30_000).optional(),
    value: z.string().max(30_000).optional(),
    key: z.string().optional(),
    scrollY: z.number().optional(),
    scrollX: z.number().optional(),
    credential: z.enum(["username", "email", "password"]).optional(),
  })
  .refine(
    (value) => value.ref === undefined || value.selector === undefined,
    "Choose either ref or selector, never both",
  );
export const PromotionToolSchema = z.discriminatedUnion("endpoint", [
  z.strictObject({
    endpoint: z.literal("navigate"),
    body: z.strictObject({ url: z.url() }),
  }),
  z.strictObject({
    endpoint: z.literal("snapshot"),
    body: z
      .strictObject({
        selector: z.string().min(1).max(1000).optional(),
        depth: z.number().int().min(0).max(30).optional(),
      })
      .optional(),
  }),
  z.strictObject({ endpoint: z.literal("screenshot") }),
  z.strictObject({ endpoint: z.literal("action"), body: ActionSchema }),
  z.strictObject({
    endpoint: z.literal("attr"),
    body: z.strictObject({
      selector: z.string(),
      name: z.enum([
        "href",
        "type",
        "datetime",
        "disabled",
        "role",
        "name",
        "title",
        "aria-label",
      ]),
    }),
  }),
  z.strictObject({ endpoint: z.literal("solve-captcha") }),
]);
export const PromotionLoginsSchema = z.record(
  z.string(),
  z.strictObject({
    username: z.string().min(1),
    email: z.email().optional(),
    password: z.string().min(1),
  }),
);

function isSignInControl(node: {
  role: string;
  name?: string | undefined;
}): boolean {
  return (
    node.role === "button" &&
    /\b(?:log|sign)\s*in\b/i.test(node.name ?? "") &&
    !/\b(?:bump|vote|publish|post|purchase|delete)\b/i.test(node.name ?? "")
  );
}

/** Native browser actions; there are no site-specific sequences or selectors. */
export function createPromotionToolHandler(input: {
  browser: PromotionBrowser;
  journal: PromotionTaskJournal;
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
  let queue: Promise<unknown> = Promise.resolve();
  let toolCalls = 0,
    loginSubmitted = false;
  let loginPage: string | undefined;

  async function credentialAction(body: z.infer<typeof ActionSchema>) {
    if (input.reconciliation) throw new Error("Reconciliation never signs in");
    if (
      !["fill", "type"].includes(body.kind) ||
      body.ref === undefined ||
      body.text !== undefined ||
      body.value !== undefined ||
      body.selector !== undefined ||
      body.credential === undefined
    )
      throw new Error(
        "Credentials require a native fill/type reference without literal text",
      );
    if (loginSubmitted)
      throw new Error(
        "Login already submitted; inspect the result instead of retrying",
      );
    const login = input.logins[input.account];
    if (login === undefined)
      throw new Error("Stored login is unavailable for this account");
    const value =
      body.credential === "email"
        ? (login.email ??
          (z.email().safeParse(login.username).success
            ? login.username
            : undefined))
        : login[body.credential];
    if (value === undefined)
      throw new Error("Stored email is unavailable for this account");
    const node = await input.browser.accessibleControl(body.ref);
    const type = await input.browser.attribute(body.ref, "type");
    if (
      node.role !== "textbox" ||
      (body.credential === "password"
        ? type !== "password"
        : ![null, "text", "email"].includes(type))
    )
      throw new Error(
        "Credential reference must identify the matching native input",
      );
    const page = await input.browser.currentUrl();
    const { credential, ...nativeAction } = body;
    if (body.kind === "type")
      await input.browser.action({ kind: "fill", ref: body.ref, text: "" });
    await input.browser.action({ ...nativeAction, text: value });
    if (credential === "password") loginPage = page;
    return { filled: true };
  }

  async function submitLogin(body: z.infer<typeof ActionSchema>) {
    if (loginSubmitted)
      throw new Error(
        "Login already submitted; inspect the result instead of retrying",
      );
    if (loginPage !== (await input.browser.currentUrl()))
      throw new Error("Fill the stored password on this page before login");
    if (
      body.ref !== undefined &&
      (await input.browser.attribute(body.ref, "disabled")) !== null
    )
      throw new Error(
        "Login control is disabled; inspect the form before submitting",
      );
    loginSubmitted = true;
    return await input.browser.action(body);
  }

  async function action(body: z.infer<typeof ActionSchema>) {
    if (body.credential !== undefined) return await credentialAction(body);
    if (["scroll", "hover"].includes(body.kind))
      return await input.browser.action(body);
    if (await isSearchAction(body)) return await input.browser.action(body);
    if (
      body.kind === "click" &&
      body.ref !== undefined &&
      !input.reconciliation
    ) {
      const node = await input.browser.accessibleControl(body.ref);
      if (node.role === "link") {
        const href = await input.browser.attribute(body.ref, "href");
        if (href === null) throw new Error("Navigation link has no URL");
        return await navigate(
          new URL(href, await input.browser.currentUrl()).href,
        );
      }
      if (isSignInControl(node)) {
        return await submitLogin(body);
      }
    }
    const text = body.text ?? body.value;
    await input.journal.beforeMutation(
      text !== undefined && ["fill", "type"].includes(body.kind)
        ? { key: body.ref ?? body.selector ?? "input", text }
        : undefined,
    );
    try {
      return await input.browser.action(body);
    } catch (error: unknown) {
      input.journal.mutationFailed();
      throw error;
    }
  }

  async function isSearchAction(
    body: z.infer<typeof ActionSchema>,
  ): Promise<boolean> {
    if (
      body.ref === undefined ||
      !["fill", "type", "press"].includes(body.kind)
    )
      return false;
    if (body.kind === "press" && body.key !== "Enter") return false;
    const type = await input.browser.attribute(body.ref, "type");
    if (type === "search") return true;
    const role = await input.browser.attribute(body.ref, "role");
    return (
      role === "searchbox" ||
      (role === "combobox" &&
        /\bsearch\b/i.test(
          (await input.browser.attribute(body.ref, "aria-label")) ?? "",
        ))
    );
  }

  async function navigate(url: string) {
    const address = new URL(url);
    const mutation =
      /\b(?:bump|vote|delete|remove|logout|send|confirm)\b/i.test(
        decodeURIComponent(`${address.pathname} ${address.search}`),
      );
    if (mutation) await input.journal.beforeMutation();
    loginPage = undefined;
    try {
      return await input.browser.open(url);
    } catch (error: unknown) {
      if (mutation) input.journal.mutationFailed();
      throw error;
    }
  }

  async function handle(raw: unknown): Promise<unknown> {
    if (input.signal.aborted) throw new Error("Promotion run cancelled");
    const tool = PromotionToolSchema.parse(raw);
    if (++toolCalls > input.maxToolCalls)
      throw new Error("Browser tool budget exhausted");
    assertPromotionOwnership(
      await readPromotionState(input.store, input.targetId),
      input.occurrenceId,
    );
    input.heartbeat();
    switch (tool.endpoint) {
      case "navigate":
        return await navigate(tool.body.url);
      case "snapshot": {
        const page = await input.browser.snapshot(tool.body);
        input.journal.observe(page);
        return { untrustedPageContent: page };
      }
      case "attr":
        return await input.browser.attribute(
          tool.body.selector,
          tool.body.name,
        );
      case "action":
        return await action(tool.body);
      case "screenshot":
        return {
          png: Buffer.from(await input.browser.screenshot()).toString("base64"),
        };
      case "solve-captcha": {
        if (input.preview || input.reconciliation)
          throw new Error("Read-only mode cannot create paid CAPTCHA tasks");
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
      }
    }
  }
  return async (raw: unknown): Promise<unknown> => {
    const previous = queue;
    const next = Promise.withResolvers<undefined>();
    queue = next.promise;
    await previous;
    try {
      return await handle(raw);
    } finally {
      next.resolve(undefined);
    }
  };
}
