import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import { promotionPublicUrl, redactPromotionUrls } from "./redaction.ts";
import {
  assertPromotionUrl,
  type PromotionTarget,
} from "#shared/promotion/model.ts";
import { reportReceiptStore } from "#activities/reports/report-object-store.ts";
import { promotionStoragePrefix } from "./store.ts";
import {
  captchaApplicationScript,
  captchaResponsePresent,
  captchaChallengePresent,
} from "./browser-scripts.ts";
import {
  installChallengeCapture,
  readChallenge,
  applyCloudflareChallenge,
  cloudflareInterstitial,
  cloudflareChallengeActive,
} from "./access/challenge-scripts.ts";
import type { PromotionChallenge } from "./solver.ts";
import {
  PromotionBrowserProfile,
  ProfilesSchema,
  InstancesSchema,
} from "./access/browser-profile.ts";

const IdentifierSchema = z.object({
  id: z.string().optional(),
  instanceId: z.string().optional(),
  tabId: z.string().optional(),
});
const EvaluationSchema = z.object({ result: z.unknown() });
const AccessibleNodeSchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string().optional(),
  depth: z.number().int().nonnegative().optional(),
  tag: z.string().optional(),
  disabled: z.boolean().optional(),
});
const SnapshotSchema = z.object({
  nodes: z.array(AccessibleNodeSchema),
  idpiNotice: z.string(),
  untrustedContent: z.boolean(),
  idpiWarning: z.string().optional(),
});
const CloudflareResultSchema = z.object({
  solver: z.literal("cloudflare"),
  solved: z.boolean(),
  attempts: z.number().int().nonnegative(),
  handoff: z.literal("paused_handoff").optional(),
});
type SnapshotScope = {
  selector?: string | undefined;
  depth?: number | undefined;
};

class PromotionBrowserHttpError extends Error {
  readonly status: number;
  constructor(suffix: string, status: number, detail: string) {
    super(`Promotion browser ${suffix} HTTP ${String(status)}: ${detail}`);
    this.status = status;
  }
}
/** Authenticated transport for native PinchTab operations on one owned tab. */
export class PromotionBrowser {
  private readonly target: PromotionTarget;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly signal: AbortSignal;
  private tabId: string | undefined;
  private readonly profile: PromotionBrowserProfile;
  private instanceId: string | undefined;
  private preserveLastTab = false;
  private challengeState: PromotionChallenge | undefined;
  private readonly cloudflarePages = new Set<string>();
  private lastSnapshot:
    { url: string; scope: SnapshotScope | undefined } | undefined;
  private readonly controls = new Map<
    string,
    z.infer<typeof AccessibleNodeSchema>
  >();

  constructor(
    target: PromotionTarget,
    baseUrl: string,
    token: string,
    options: { signal: AbortSignal; profile?: string; temporaryProfile?: true },
  ) {
    this.target = target;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.signal = options.signal;
    this.profile = new PromotionBrowserProfile(options);
  }

  private async request(
    suffix: string,
    body?: unknown,
    signal = this.signal,
    timeoutMs = 30_000,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${suffix}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new PromotionBrowserHttpError(
        suffix,
        response.status,
        detail.slice(0, 1000),
      );
    }
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
    this.preserveLastTab =
      existing?.mode === "headed" || existing?.headless === false;
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
    this.instanceId = instanceId;
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
    this.controls.clear();
    this.lastSnapshot = undefined;
    if (this.tabId === undefined) {
      const profile =
        this.profile.name ?? `storm-promotion-${this.target.account}`;
      const response = ProfilesSchema.parse(await this.json("/profiles"));
      const profiles = Array.isArray(response) ? response : response.profiles;
      await this.profile.prepare(profile, profiles, () =>
        this.json("/profiles", { name: profile }),
      );
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
    await this.evaluate(installChallengeCapture);
    return { url: promotionPublicUrl(await this.currentUrl()) };
  }

  async snapshot(scope?: SnapshotScope): Promise<{
    url: string;
    text: string;
    publishedAt: string | null;
  }> {
    this.controls.clear();
    const url = await this.currentUrl();
    // PinchTab's snapshot performs its content scanning/wrapping before data
    // enters an agent prompt. Keep that endpoint in the observation path.
    const parameters = new URLSearchParams({
      format: "json",
      ...(scope?.selector === undefined ? {} : { selector: scope.selector }),
      ...(scope?.depth === undefined ? {} : { depth: String(scope.depth) }),
    });
    const response = await this.request(
      `${this.tab()}/snapshot?${parameters.toString()}`,
    );
    const snapshot = SnapshotSchema.parse(await response.json());
    const times = await this.evaluate(
      "Array.from(document.querySelectorAll('time[datetime]')).map(e=>({datetime:e.getAttribute('datetime'),text:e.textContent}))",
    );
    const text = redactPromotionUrls(
      JSON.stringify({ snapshot, scope: scope ?? {}, timestamps: times }),
    );
    if (text.length > 120_000) {
      this.controls.clear();
      throw new Error(
        "Promotion page exceeds observation size limit; use a narrower page",
      );
    }
    const publishedAt = this.target.id.startsWith("reddit-")
      ? z
          .string()
          .nullable()
          .parse(
            await this.evaluate(
              "(() => { const parts=location.pathname.split('/'); const index=parts.indexOf('comments'); const id=index<0?null:parts[index+1]; if(!id) return null; const old=document.querySelector('[data-fullname=\"t3_'+id+'\"] .tagline time[datetime]'); const modern=document.querySelector('shreddit-post[id=\"t3_'+id+'\"],shreddit-post[post-id=\"t3_'+id+'\"]'); return old?.getAttribute('datetime')||modern?.getAttribute('created-timestamp')||modern?.querySelector('time[datetime]')?.getAttribute('datetime')||null; })()",
            ),
          )
      : null;
    for (const node of snapshot.nodes) this.controls.set(node.ref, node);
    this.lastSnapshot = {
      url,
      scope: scope === undefined ? undefined : { ...scope },
    };
    return { url: promotionPublicUrl(url), text, publishedAt };
  }

  async action(body: Record<string, unknown>): Promise<unknown> {
    const before = await this.currentUrl();
    const result = await this.json(`${this.tab()}/action`, body);
    if ((await this.currentUrl()) !== before) {
      this.controls.clear();
      await this.evaluate(installChallengeCapture);
    }
    return result;
  }

  async controlState(ref: string) {
    await this.accessibleControl(ref);
    const query = new URLSearchParams({ selector: ref });
    const visible = z
      .object({ visible: z.boolean(), onScreen: z.boolean().optional() })
      .parse(await this.json(`${this.tab()}/visible?${query.toString()}`));
    const enabled = z
      .object({ enabled: z.boolean() })
      .parse(await this.json(`${this.tab()}/enabled?${query.toString()}`));
    return {
      rendered: visible.visible,
      onScreen: visible.onScreen ?? null,
      enabled: enabled.enabled,
    };
  }
  /** Native hover may scroll/expose menus; it validates pointer access without forcing a click. */
  async preparePointer(ref: string): Promise<void> {
    await this.accessibleControl(ref);
    await this.action({ kind: "hover", ref });
  }
  async followLink(
    body: Record<string, unknown>,
    address: string,
  ): Promise<unknown> {
    assertPromotionUrl(this.target, address);
    return await this.action(body);
  }

  async attribute(selector: string, name: string): Promise<string | null> {
    await this.currentUrl();
    return z
      .object({ value: z.string().nullable() })
      .parse(
        await this.json(
          `${this.tab()}/attr?${new URLSearchParams({ selector, name }).toString()}`,
        ),
      ).value;
  }

  async accessibleControl(ref: string) {
    await this.currentUrl();
    const node = this.controls.get(ref);
    if (node === undefined)
      throw new Error(
        "Refresh the relevant snapshot: control reference is absent",
      );
    return node;
  }

  async challenge(): Promise<PromotionChallenge> {
    await this.evaluate(installChallengeCapture);
    const websiteURL = await this.currentUrl();
    const widget = z
      .object({
        type: z.enum(["RecaptchaV2TaskProxyless", "TurnstileTaskProxyless"]),
        websiteKey: z.string().min(1),
        action: z.string().optional(),
        cData: z.string().optional(),
        chlPageData: z.string().optional(),
      })
      .parse(await this.evaluate(readChallenge));
    const challenge = { ...widget, websiteURL };
    this.challengeState = challenge;
    return challenge;
  }

  async challengeContext() {
    const challenge = await this.challenge();
    const documentId = z
      .string()
      .min(1)
      .parse(await this.evaluate("window.__stormCaptchaCapture.documentId"));
    return { challenge, documentId };
  }

  async hasCaptchaResponse() {
    await this.currentUrl();
    return z.boolean().parse(await this.evaluate(captchaResponsePresent));
  }

  async requiresCaptchaResponse() {
    await this.currentUrl();
    const present = z
      .boolean()
      .parse(await this.evaluate(captchaChallengePresent));
    return present && !(await this.hasCaptchaResponse());
  }

  async solveCloudflare() {
    const before = await this.currentUrl();
    if (this.lastSnapshot?.url !== before)
      throw new Error("Take a scanned snapshot of this challenge page first");
    if (!z.boolean().parse(await this.evaluate(cloudflareInterstitial)))
      throw new Error(
        "Native solver requires a Cloudflare interstitial without a publication or login form",
      );
    if (this.cloudflarePages.has(before) || this.cloudflarePages.size >= 2)
      throw new Error(
        "Native Cloudflare attempt already used for this page or run",
      );
    this.cloudflarePages.add(before);
    this.controls.clear();
    this.lastSnapshot = undefined;
    this.challengeState = undefined;
    const response = await this.request(
      `${this.tab()}/solve/cloudflare`,
      { maxAttempts: 1, timeout: 60_000 },
      this.signal,
      70_000,
    );
    const result = CloudflareResultSchema.parse(await response.json());
    const handoff = result.handoff === "paused_handoff";
    const after = handoff ? before : await this.currentUrl();
    const solved =
      !handoff &&
      result.solved &&
      !z.boolean().parse(await this.evaluate(cloudflareChallengeActive));
    return {
      solver: result.solver,
      solved,
      attempts: result.attempts,
      handoff,
      url: promotionPublicUrl(after),
      formSubmitted: false,
    };
  }

  async applyChallenge(token: string): Promise<void> {
    await this.currentUrl();
    if (this.challengeState?.websiteURL !== (await this.currentUrl()))
      throw new Error("CAPTCHA page changed before token application");
    await this.evaluate(
      this.challengeState.chlPageData === undefined
        ? captchaApplicationScript(token)
        : applyCloudflareChallenge(token),
    );
    this.challengeState = undefined;
  }

  async screenshot(): Promise<Uint8Array> {
    await this.currentUrl();
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
    return bytes;
  }

  async capture(occurrenceId: string): Promise<{
    url: string;
    text: string;
    screenshotKey: string;
    publishedAt: string | null;
  }> {
    const page = await this.receiptSnapshot();
    const bytes = await this.screenshot();
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

  /** Independently reread the last successful region on this same receipt page. */
  async receiptSnapshot() {
    const url = await this.currentUrl();
    const scope =
      this.lastSnapshot?.url === url ? this.lastSnapshot.scope : undefined;
    return await this.snapshot(scope);
  }

  private async instanceTabs(signal: AbortSignal) {
    if (this.instanceId === undefined)
      throw new Error("Owned browser instance is missing");
    const response = await this.request(
      `/instances/${encodeURIComponent(this.instanceId)}/tabs`,
      undefined,
      signal,
    );
    return z.array(IdentifierSchema).parse(await response.json());
  }

  async close(): Promise<void> {
    if (await this.profile.close(this.baseUrl, this.token)) {
      this.tabId = undefined;
      this.instanceId = undefined;
      return;
    }
    if (this.tabId === undefined) return;
    const cleanupSignal = AbortSignal.timeout(10_000);
    if (this.preserveLastTab && this.instanceId !== undefined) {
      const tabs = await this.instanceTabs(cleanupSignal);
      if (tabs.length === 1 && (tabs[0]?.id ?? tabs[0]?.tabId) === this.tabId) {
        // Closing the last headed window leaves Chrome unable to create a
        // later tab. Keep one clean landing page, not a verification form.
        await this.request(
          `${this.tab()}/navigate`,
          { url: this.target.url },
          cleanupSignal,
        );
        return;
      }
    }
    await this.request(`${this.tab()}/close`, {}, cleanupSignal);
    const deadline = Date.now() + 5000;
    for (;;) {
      const remainingTabs = await this.instanceTabs(cleanupSignal);
      if (!remainingTabs.some((tab) => (tab.id ?? tab.tabId) === this.tabId))
        return;
      if (Date.now() >= deadline)
        throw new Error("Owned task tab did not finish closing");
      await Bun.sleep(50);
    }
  }
}
