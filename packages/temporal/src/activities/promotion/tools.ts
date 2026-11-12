import { z } from "zod/v4";
import { PromotionControlError } from "./control-error.ts";
import type { PromotionBrowser } from "./browser.ts";
import type { PromotionTaskJournal } from "./publication/task.ts";
import {
  assertPromotionOwnership,
  readPromotionState,
  type PromotionStore,
} from "./store.ts";
import { solvePromotionChallenge } from "./solver.ts";
import {
  promotionCredentialValue,
  assertPromotionCredentialInput,
  assertPromotionEmailCodePage,
  type PromotionEmailCodeReader,
} from "./access/credential-input.ts";
import { PromotionAuthentication } from "./access/authentication.ts";
import { PromotionCaptchaSession } from "./access/captcha-session.ts";

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
    waitNav: z.boolean().optional(),
    submit: z.boolean().optional(),
    credential: z
      .enum(["username", "email", "password", "otp", "email-code"])
      .optional(),
  })
  .refine(
    (value) => value.ref === undefined || value.selector === undefined,
    "Choose either ref or selector, never both",
  )
  .refine(
    (value) => value.submit !== true || value.waitNav !== true,
    "Choose submit or waitNav, never both",
  );
export const PromotionToolSchema = z.discriminatedUnion("endpoint", [
  z.strictObject({
    endpoint: z.literal("control-state"),
    body: z.strictObject({ ref: z.string().regex(/^e\d+$/) }),
  }),
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
        "aria-expanded",
        "aria-haspopup",
        "aria-controls",
      ]),
    }),
  }),
  z.strictObject({ endpoint: z.literal("solve-captcha") }),
  z.strictObject({ endpoint: z.literal("solve-cloudflare") }),
]);
export const PromotionLoginsSchema = z.record(
  z.string(),
  z.strictObject({
    username: z.string().min(1),
    email: z.email().optional(),
    password: z.string().min(1),
    hosts: z.array(z.string().min(1)).min(1).optional(),
    otp: z.string().min(1).optional(),
  }),
);

function assertLoginHost(hosts: string[] | undefined, page: string): void {
  if (hosts !== undefined && !hosts.includes(new URL(page).hostname))
    throw new Error("Stored credentials are not assigned to this login host");
}

function navigationMutation(address: URL): boolean {
  return /\b(?:bump|vote|delete|remove|logout|send|confirm)\b/i.test(
    decodeURIComponent(`${address.pathname} ${address.search}`),
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
  registerSecret?: (value: string) => void;
  readEmailCode?: PromotionEmailCodeReader;
}) {
  const startedAt = Date.now();
  let queue: Promise<unknown> = Promise.resolve();
  let toolCalls = 0;
  const authentication = new PromotionAuthentication(input.browser);
  const captcha = new PromotionCaptchaSession();

  async function credentialAction(body: z.infer<typeof ActionSchema>) {
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
    authentication.assertCredential(body.credential);
    const login = input.logins[input.account];
    if (login === undefined)
      throw new Error("Stored login is unavailable for this account");
    const page = await input.browser.currentUrl();
    assertLoginHost(login.hosts, page);
    const node = await input.browser.accessibleControl(body.ref);
    const type = await input.browser.attribute(body.ref, "type");
    assertPromotionCredentialInput(node, type, body.credential);
    const value =
      body.credential === "email-code"
        ? await emailCode(login, page)
        : promotionCredentialValue(login, body.credential);
    const { credential, ...nativeAction } = body;
    input.registerSecret?.(value);
    if (body.kind === "type")
      await input.browser.action({ kind: "fill", ref: body.ref, text: "" });
    await input.browser.action({ ...nativeAction, text: value });
    authentication.record(credential, page);
    return { filled: true };
  }

  async function emailCode(
    login: z.infer<typeof PromotionLoginsSchema>[string],
    page: string,
  ): Promise<string> {
    assertPromotionEmailCodePage(input.account, page);
    if (input.readEmailCode === undefined)
      throw new Error("Private email-code access is not enabled for this run");
    const recipient = login.email ?? login.username;
    if (!z.email().safeParse(recipient).success)
      throw new Error("Stored account email is required for verification mail");
    return await input.readEmailCode({
      account: input.account,
      recipient,
      after: startedAt,
      signal: input.signal,
    });
  }

  async function assertEnabledControl(ref: string) {
    const state = await input.browser.controlState(ref).catch(() => {
      throw new PromotionControlError(ref, "inspection_failed");
    });
    if (!state.rendered || !state.enabled) {
      if (state.rendered && !state.enabled) {
        const node = await input.browser.accessibleControl(ref);
        if (/cooldown|bump again in|try again in/i.test(node.name ?? ""))
          input.journal.observeNativeCooldown();
      }
      throw new PromotionControlError(ref);
    }
    await input.browser.preparePointer(ref).catch(() => {
      throw new PromotionControlError(ref, "pointer_preflight_failed");
    });
  }

  async function action(body: z.infer<typeof ActionSchema>) {
    if (body.kind === "click" && body.ref !== undefined)
      await assertEnabledControl(body.ref);
    if (body.credential !== undefined) return await credentialAction(body);
    if (["scroll", "hover"].includes(body.kind))
      return await input.browser.action(body);
    if (await isSearchAction(body)) return await input.browser.action(body);
    const click = await inspectionClick(body);
    if (click.handled) return click.result;
    if (await disclosureAction(body)) return await input.browser.action(body);
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

  async function inspectionClick(
    body: z.infer<typeof ActionSchema>,
  ): Promise<{ handled: boolean; result?: unknown }> {
    if (body.kind !== "click" || body.ref === undefined)
      return { handled: false };
    const node = await input.browser.accessibleControl(body.ref);
    if (node.role === "link") {
      const href = await input.browser.attribute(body.ref, "href");
      if (href === null) throw new Error("Navigation link has no URL");
      const before = await input.browser.currentUrl();
      const address = new URL(href, before);
      const mutation =
        navigationMutation(address) ||
        /\b(?:bump|vote|delete|remove|save|logout|log out|sign out|purchase|join|accept)\b/i.test(
          node.name ?? "",
        ) ||
        ((href === "" || href.startsWith("#")) &&
          /\b(?:publish|post|reply|send|submit|comment)\b/i.test(
            node.name ?? "",
          ));
      if (mutation) await input.journal.beforeMutation();
      try {
        const result = await input.browser.followLink(body, address.href);
        if ((await input.browser.currentUrl()) !== before)
          authentication.navigated();
        return { handled: true, result };
      } catch (error: unknown) {
        if (mutation) input.journal.mutationFailed();
        throw error;
      }
    }
    return authentication.allowsControl(node, await input.browser.currentUrl())
      ? {
          handled: true,
          result: await authentication.submit({ ...body, ref: body.ref }),
        }
      : { handled: false };
  }

  async function disclosureAction(
    body: z.infer<typeof ActionSchema>,
  ): Promise<boolean> {
    return !input.preview || body.kind !== "click" || body.ref === undefined
      ? false
      : await isDisclosure(
          body.ref,
          await input.browser.accessibleControl(body.ref),
        );
  }

  async function isDisclosure(
    ref: string,
    node: { role: string; name?: string | undefined },
  ): Promise<boolean> {
    if (
      !["button", "tab"].includes(node.role) ||
      /\b(?:bump|vote|publish|post|reply|comment|send|submit|purchase|delete|remove|save|accept|join)\b/i.test(
        node.name ?? "",
      )
    )
      return false;
    const type = await input.browser.attribute(ref, "type");
    if (type === "submit" || type === "reset") return false;
    if (node.role === "tab") return true;
    const popup = await input.browser.attribute(ref, "aria-haspopup");
    return (
      ["true", "menu", "listbox", "tree", "grid", "dialog"].includes(
        popup ?? "",
      ) ||
      ["true", "false"].includes(
        (await input.browser.attribute(ref, "aria-expanded")) ?? "",
      )
    );
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
    const mutation = navigationMutation(address);
    if (mutation) await input.journal.beforeMutation();
    authentication.navigated();
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
      case "control-state":
        return await input.browser.controlState(tool.body.ref);
      case "navigate":
        return await navigate(tool.body.url);
      case "snapshot": {
        const page = await input.browser.snapshot(tool.body);
        const observation = input.journal.observe(page);
        return {
          observationId: observation.reference,
          untrustedPageContent: page,
        };
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
        if (input.reconciliation)
          throw new Error("Read-only mode cannot create paid CAPTCHA tasks");
        if (await input.browser.hasCaptchaResponse())
          return {
            alreadyStaged: true,
            responseStaged: true,
            paidSolverTaskCreated: false,
            formSubmitted: false,
            siteAccepted: false,
          };
        const context = await input.browser.challengeContext();
        return await captcha.solve({
          ...context,
          apply: (token) => input.browser.applyChallenge(token),
          acquire: (onSolved) =>
            solvePromotionChallenge({
              store: input.store,
              occurrenceId: input.occurrenceId,
              challenge: context.challenge,
              apiKey: input.solverKey,
              allowanceMicrousd: input.solverAllowanceMicrousd,
              signal: input.signal,
              heartbeat: input.heartbeat,
              registerSecret: input.registerSecret,
              apply: (token) => input.browser.applyChallenge(token),
              onSolved,
            }),
        });
      }
      case "solve-cloudflare":
        if (input.reconciliation)
          throw new Error("Reconciliation cannot solve access challenges");
        return await input.browser.solveCloudflare();
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
