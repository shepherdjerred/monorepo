import { z } from "zod/v4";
import { promotionPublicUrl } from "./redaction.ts";
import { PromotionBrowserHttpError } from "./access/browser-http-error.ts";
import {
  readPromotionBrowserSnapshot,
  type SnapshotScope,
  type AccessibleNode,
} from "./access/browser-snapshot.ts";
import {
  assertPromotionUrl,
  type PromotionTarget,
} from "#shared/promotion/model.ts";
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
  redditBrowserRateLimit,
  reportRedditBrowserFailure,
  RedditBrowserAccount,
} from "./access/reddit-account.ts";
import {
  readRedditListing,
  readRedditThread,
  readRedditThreadSnapshot,
  readRedditCommentReceipt,
  readRedditFeedPage,
  readRedditRules,
} from "./reddit-discovery/browser-reader.ts";
import {
  PromotionBrowserProfile,
  ProfilesSchema,
  InstancesSchema,
  BrowserIdentifierSchema as IdentifierSchema,
  type PromotionBrowserOptions,
} from "./access/browser-profile.ts";

const EvaluationSchema = z.object({ result: z.unknown() });
const CloudflareResultSchema = z.object({
  solver: z.literal("cloudflare"),
  solved: z.boolean(),
  attempts: z.number().int().nonnegative(),
  handoff: z.literal("paused_handoff").optional(),
});

/** Authenticated transport for native PinchTab operations on one owned tab. */
export class PromotionBrowser {
  private readonly target: PromotionTarget;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly signal: AbortSignal;
  private readonly captureChallenges: boolean;
  private readonly options: PromotionBrowserOptions;
  private readonly reddit: RedditBrowserAccount;
  private tabId: string | undefined;
  private readonly profile: PromotionBrowserProfile;
  private instanceId: string | undefined;
  private preserveLastTab = false;
  private challengeState: PromotionChallenge | undefined;
  private readonly cloudflarePages = new Set<string>();
  private lastSnapshot:
    { url: string; scope: SnapshotScope | undefined } | undefined;
  private readonly controls = new Map<string, AccessibleNode>();

  constructor(
    target: PromotionTarget,
    baseUrl: string,
    token: string,
    options: PromotionBrowserOptions,
  ) {
    this.target = target;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.signal = options.signal;
    this.reddit = new RedditBrowserAccount(options);
    this.options = this.reddit.options;
    this.captureChallenges = options.captureChallenges !== false;
    this.profile = new PromotionBrowserProfile(options);
  }

  private async request(
    suffix: string,
    body?: unknown,
    signal = this.signal,
    timeoutMs = 30_000,
  ): Promise<Response> {
    this.reddit.assertRequest(suffix);
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
      if (response.status === 429 && this.options.redditAccount !== undefined) {
        const failure = redditBrowserRateLimit(
          response.headers.get("retry-after"),
        );
        await reportRedditBrowserFailure(this.options, failure);
        throw failure;
      }
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
    if (this.target.account === "reddit")
      await this.options.beforeRedditNavigation?.();
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
    if (this.captureChallenges) await this.evaluate(installChallengeCapture);
    return { url: promotionPublicUrl(await this.currentUrl()) };
  }

  async snapshot(scope?: SnapshotScope) {
    this.controls.clear();
    const url = await this.currentUrl();
    const { nodes, text, publishedAt } = await readPromotionBrowserSnapshot({
      url,
      scope,
      reddit: this.target.id.startsWith("reddit-"),
      options: this.options,
      readSnapshot: (parameters) =>
        this.json(`${this.tab()}/snapshot?${parameters.toString()}`),
      evaluate: (script) => this.evaluate(script),
    });
    for (const node of nodes) this.controls.set(node.ref, node);
    this.lastSnapshot = {
      url,
      scope: scope === undefined ? undefined : { ...scope },
    };
    return { url: promotionPublicUrl(url), text, publishedAt };
  }

  async action(body: Record<string, unknown>): Promise<unknown> {
    const before = await this.currentUrl();
    // Humanized input skips topmost checks and samples a different point each time.
    const nativeBody =
      body["kind"] === "click" ? { ...body, humanize: false } : body;
    const result = await this.json(`${this.tab()}/action`, nativeBody);
    if ((await this.currentUrl()) !== before) {
      this.controls.clear();
      if (this.captureChallenges) await this.evaluate(installChallengeCapture);
    }
    return result;
  }

  private redditReader() {
    return {
      currentUrl: () => this.currentUrl(),
      snapshot: (scope: { selector: string; depth?: number }) =>
        this.snapshot(scope),
      evaluate: (expression: string) => this.evaluate(expression),
    };
  }
  async readRedditListing(input: { subreddit: string; limit: number }) {
    return await readRedditListing(this.redditReader(), input);
  }
  async readRedditFeedPage(input: {
    subreddit: string;
    limit: number;
    account: string;
    after?: string | null;
  }) {
    return await readRedditFeedPage(this.redditReader(), input);
  }
  async readRedditRules(input: { subreddit: string; account: string }) {
    return await readRedditRules(this.redditReader(), input);
  }
  async readRedditThread(input: { account: string }) {
    return await readRedditThread(this.redditReader(), input);
  }
  async readRedditThreadSnapshot(input: { account: string }) {
    return await readRedditThreadSnapshot(this.redditReader(), input);
  }
  async readRedditCommentReceipt() {
    return await readRedditCommentReceipt(this.redditReader());
  }
  async assertRedditReplyThread() {
    const current = new URL(await this.currentUrl());
    const assigned = new URL(this.target.url);
    if (
      this.target.action !== "reply" ||
      current.hostname !== "old.reddit.com" ||
      !current.pathname.startsWith(assigned.pathname) ||
      current.pathname
        .slice(assigned.pathname.length)
        .split("/")
        .filter(Boolean).length > 1
    )
      throw new Error("Reddit reply requires the assigned top-level thread");
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
    await this.action({ kind: "hover", ref, humanize: false });
    await this.accessibleControl(ref);
  }
  async followLink(
    body: Record<string, unknown>,
    address: string,
  ): Promise<unknown> {
    assertPromotionUrl(this.target, address);
    if (this.target.account === "reddit")
      await this.options.beforeRedditNavigation?.();
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

  private keepRedditTab() {
    return (
      this.target.account === "reddit" &&
      (!this.captureChallenges || this.options.redditAccount !== undefined)
    );
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
        if (this.keepRedditTab()) return;
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
