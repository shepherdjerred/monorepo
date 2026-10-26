import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import { promotionPublicUrl, redactPromotionUrls } from "./redaction.ts";
import { assertPromotionUrl, type PromotionTarget } from "#shared/promotion.ts";
import { reportReceiptStore } from "#activities/reports/report-object-store.ts";
import { promotionStoragePrefix } from "./store.ts";
import {
  captchaApplicationScript,
  PROMOTION_CONTROLS_SCRIPT,
} from "./browser-scripts.ts";

const IdentifierSchema = z.object({
  id: z.string().optional(),
  instanceId: z.string().optional(),
  tabId: z.string().optional(),
});
const EvaluationSchema = z.object({ result: z.unknown() });
const ProfileSchema = z.object({ name: z.string() });
const ProfilesSchema = z.union([
  z.array(ProfileSchema),
  z.object({ profiles: z.array(ProfileSchema) }),
]);
const InstanceSchema = z.object({
  id: z.string(),
  profileName: z.string().optional(),
});
const InstancesSchema = z.union([
  z.array(InstanceSchema),
  z.object({ instances: z.array(InstanceSchema) }),
]);

class PromotionBrowserHttpError extends Error {
  readonly status: number;
  constructor(suffix: string, status: number) {
    super(`Promotion browser ${suffix} HTTP ${String(status)}`);
    this.status = status;
  }
}
const ControlSchema = z.object({
  tag: z.string(),
  type: z.string(),
  href: z.string(),
  label: z.string(),
  password: z.boolean(),
});

export function assertPromotionSubmitControl(
  target: PromotionTarget,
  label: string,
): void {
  if (/\b(?:vote|delete|remove|logout|purchase|pay)\b/i.test(label))
    throw new Error("Control is not a promotion submission");
  const expected =
    target.action === "bump"
      ? /\b(?:bump|refresh|renew)\b|update\s+(?:server|listing)/i
      : /\b(?:submit|post|publish|reply)\b/i;
  if (!expected.test(label))
    throw new Error(
      "Submission control must explicitly identify the intended promotion action",
    );
}

/** Parent-owned browser client. Agent tools expose fixed operations, never eval. */
export class PromotionBrowser {
  private readonly target: PromotionTarget;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly signal: AbortSignal;
  private tabId: string | undefined;

  constructor(
    target: PromotionTarget,
    baseUrl: string,
    token: string,
    signal: AbortSignal,
  ) {
    this.target = target;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.signal = signal;
  }

  private async request(
    suffix: string,
    body?: unknown,
    signal = this.signal,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${suffix}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok)
      throw new PromotionBrowserHttpError(suffix, response.status);
    return response;
  }

  private async json(suffix: string, body?: unknown): Promise<unknown> {
    const response = await this.request(suffix, body);
    return await response.json();
  }

  private tab(): string {
    if (this.tabId === undefined)
      throw new Error("Open a promotion page first");
    return `/tabs/${encodeURIComponent(this.tabId)}`;
  }

  private async evaluate(expression: string): Promise<unknown> {
    return EvaluationSchema.parse(
      await this.json(`${this.tab()}/evaluate`, { expression }),
    ).result;
  }

  private async instance(profile: string): Promise<string> {
    const response = InstancesSchema.parse(await this.json("/instances"));
    const instances = Array.isArray(response) ? response : response.instances;
    const existing = instances.find((item) => item.profileName === profile);
    let instanceId = existing?.id;
    if (instanceId === undefined) {
      const started = IdentifierSchema.parse(
        await this.json(`/profiles/${encodeURIComponent(profile)}/start`, {
          headless: true,
        }),
      );
      instanceId = started.instanceId ?? started.id;
    }
    if (instanceId === undefined)
      throw new Error("Browser profile start omitted instance ID");
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        await this.json(`/instances/${encodeURIComponent(instanceId)}/tabs`);
        return instanceId;
      } catch (error: unknown) {
        if (
          !(error instanceof PromotionBrowserHttpError) ||
          error.status !== 503 ||
          Date.now() >= deadline
        )
          throw error;
        await Bun.sleep(250);
      }
    }
  }

  async currentUrl(): Promise<string> {
    const url = z.string().parse(await this.evaluate("location.href"));
    assertPromotionUrl(this.target, url);
    return url;
  }

  async open(address: string): Promise<{ url: string }> {
    const url = assertPromotionUrl(this.target, address);
    // GET action links can also mutate a listing. Those must use publish().
    if (
      /\b(?:bump|vote|delete|remove|logout|send|confirm)\b/i.test(
        `${url.pathname} ${url.search}`,
      )
    )
      throw new Error("Action URLs must use the guarded publish tool");
    if (this.tabId === undefined) {
      const profile = `storm-promotion-${this.target.account}`;
      const response = ProfilesSchema.parse(await this.json("/profiles"));
      const profiles = Array.isArray(response) ? response : response.profiles;
      if (!profiles.some((existing) => existing.name === profile))
        await this.json("/profiles", { name: profile });
      const instanceId = await this.instance(profile);
      const opened = IdentifierSchema.parse(
        await this.json(
          `/instances/${encodeURIComponent(instanceId)}/tabs/open`,
          { url: url.href },
        ),
      );
      this.tabId = opened.tabId ?? opened.id;
      if (this.tabId === undefined)
        throw new Error("Browser tab creation omitted tab ID");
    } else await this.json(`${this.tab()}/navigate`, { url: url.href });
    return { url: promotionPublicUrl(await this.currentUrl()) };
  }

  async snapshot(): Promise<{
    url: string;
    text: string;
    publishedAt: string | null;
  }> {
    const url = await this.currentUrl();
    // PinchTab's snapshot performs its content scanning/wrapping before data
    // enters an agent prompt. Keep that endpoint in the observation path.
    const snapshot = await this.json(`${this.tab()}/snapshot`);
    const times = await this.evaluate(
      "Array.from(document.querySelectorAll('time[datetime]')).map(e=>({datetime:e.getAttribute('datetime'),text:e.textContent}))",
    );
    const controls = await this.evaluate(PROMOTION_CONTROLS_SCRIPT);
    const text = redactPromotionUrls(
      JSON.stringify({ snapshot, timestamps: times, controls }),
    );
    if (text.length > 120_000)
      throw new Error(
        "Promotion page exceeds observation size limit; use a narrower page",
      );
    const publishedAt = this.target.id.startsWith("reddit-")
      ? z
          .string()
          .nullable()
          .parse(
            await this.evaluate(
              String.raw`(() => { const id=location.pathname.match(/\/comments\/([a-z0-9]+)\//i)?.[1]; if(!id) return null; return document.querySelector('[data-fullname="t3_'+id+'"] .tagline time[datetime]')?.getAttribute('datetime')||null; })()`,
            ),
          )
      : null;
    return { url: promotionPublicUrl(url), text, publishedAt };
  }

  private async control(selector: string) {
    await this.currentUrl();
    const source = `(() => { const nodes=document.querySelectorAll(${JSON.stringify(selector)}); if(nodes.length!==1) throw new Error('Selector must match exactly one element'); const e=nodes[0]; return {tag:e.tagName.toLowerCase(),type:e.type||'',href:e.href||'',label:(e.innerText||e.getAttribute('aria-label')||e.value||e.name||'').slice(0,300),password:e.type==='password'}; })()`;
    return ControlSchema.parse(await this.evaluate(source));
  }

  async fill(selector: string, text: string): Promise<void> {
    const control = await this.control(selector);
    if (
      !["input", "textarea", "select"].includes(control.tag) ||
      ["submit", "button", "hidden", "file", "password"].includes(control.type)
    )
      throw new Error(
        "Fill requires an ordinary visible form field; credentials use login",
      );
    await this.json(`${this.tab()}/action`, { action: "fill", selector, text });
  }

  async navigateLink(selector: string): Promise<{ url: string }> {
    const control = await this.control(selector);
    if (control.tag !== "a" || control.href === "")
      throw new Error("Navigation requires a link with an explicit URL");
    return await this.open(control.href);
  }

  async submit(selector: string): Promise<void> {
    const control = await this.control(selector);
    assertPromotionSubmitControl(this.target, control.label);
    await this.json(`${this.tab()}/action`, { action: "click", selector });
    await this.currentUrl();
  }

  async login(input: {
    username: string;
    password: string;
    usernameSelector: string;
    passwordSelector: string;
    submitSelector: string;
  }): Promise<void> {
    const password = await this.control(input.passwordSelector);
    if (!password.password)
      throw new Error("Login password selector must identify a password input");
    await this.json(`${this.tab()}/action`, {
      action: "fill",
      selector: input.usernameSelector,
      text: input.username,
    });
    await this.json(`${this.tab()}/action`, {
      action: "fill",
      selector: input.passwordSelector,
      text: input.password,
    });
    const submit = await this.control(input.submitSelector);
    if (!/log\s*in|sign\s*in/i.test(submit.label))
      throw new Error("Login submit must be labeled Log in or Sign in");
    await this.json(`${this.tab()}/action`, {
      action: "click",
      selector: input.submitSelector,
    });
    await this.currentUrl();
  }

  async challenge(): Promise<{
    type: "RecaptchaV2TaskProxyless" | "TurnstileTaskProxyless";
    websiteURL: string;
    websiteKey: string;
  }> {
    const websiteURL = await this.currentUrl();
    const widget = z
      .object({
        type: z.enum(["RecaptchaV2TaskProxyless", "TurnstileTaskProxyless"]),
        websiteKey: z.string().min(1),
      })
      .parse(
        await this.evaluate(
          "(() => { const e=document.querySelector('.g-recaptcha[data-sitekey],.cf-turnstile[data-sitekey]'); if(!e) throw new Error('Supported CAPTCHA widget not found'); return {type:e.classList.contains('cf-turnstile')?'TurnstileTaskProxyless':'RecaptchaV2TaskProxyless',websiteKey:e.getAttribute('data-sitekey')}; })()",
        ),
      );
    return { ...widget, websiteURL };
  }

  async applyChallenge(token: string): Promise<void> {
    await this.currentUrl();
    await this.evaluate(captchaApplicationScript(token));
  }

  async capture(occurrenceId: string): Promise<{
    url: string;
    text: string;
    screenshotKey: string;
    publishedAt: string | null;
  }> {
    const page = await this.snapshot();
    const response = await this.request(
      `${this.tab()}/screenshot?format=png&raw=true`,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      ![137, 80, 78, 71, 13, 10, 26, 10].every(
        (byte, index) => bytes[index] === byte,
      )
    )
      throw new Error("Promotion screenshot response is not a PNG image");
    if (bytes.length > 10 * 1024 * 1024)
      throw new Error("Promotion screenshot exceeds size limit");
    const storage = reportReceiptStore();
    const screenshotKey = `${promotionStoragePrefix()}/evidence/${this.target.id}/${encodeURIComponent(occurrenceId)}/${crypto.randomUUID()}.png`;
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: screenshotKey,
        Body: bytes,
        ContentType: "image/png",
        IfNoneMatch: "*",
      }),
    );
    const observationKey = screenshotKey.replace(/\.png$/, ".json");
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: observationKey,
        Body: JSON.stringify(page),
        ContentType: "application/json",
        IfNoneMatch: "*",
      }),
    );
    return { ...page, screenshotKey };
  }

  async close(): Promise<void> {
    if (this.tabId !== undefined)
      await this.request(
        `${this.tab()}/close`,
        {},
        AbortSignal.timeout(10_000),
      );
  }
}
