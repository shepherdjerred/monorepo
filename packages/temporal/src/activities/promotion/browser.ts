import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import { promotionPublicUrl, redactPromotionUrls } from "./redaction.ts";
import { assertPromotionUrl, type PromotionTarget } from "#shared/promotion.ts";
import { reportReceiptStore } from "#activities/reports/report-object-store.ts";
import { promotionStoragePrefix } from "./store.ts";
import { captchaApplicationScript } from "./browser-scripts.ts";
import {
  installChallengeCapture,
  readChallenge,
  applyCloudflareChallenge,
} from "./access/challenge-scripts.ts";
import type { PromotionChallenge } from "./solver.ts";

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
  disabled: z.boolean().optional(),
});
const SnapshotSchema = z.object({
  nodes: z.array(AccessibleNodeSchema),
  idpiNotice: z.string(),
  untrustedContent: z.boolean(),
  idpiWarning: z.string().optional(),
});
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
  private readonly profile: string | undefined;
  private challengeState: PromotionChallenge | undefined;
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
    options: { signal: AbortSignal; profile?: string },
  ) {
    this.target = target;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.signal = options.signal;
    this.profile = options.profile;
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
    this.controls.clear();
    this.lastSnapshot = undefined;
    if (this.tabId === undefined) {
      const profile = this.profile ?? `storm-promotion-${this.target.account}`;
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
              String.raw`(() => { const id=location.pathname.match(/\/comments\/([a-z0-9]+)\//i)?.[1]; if(!id) return null; return document.querySelector('[data-fullname="t3_'+id+'"] .tagline time[datetime]')?.getAttribute('datetime')||null; })()`,
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
    if ((await this.currentUrl()) !== before) this.controls.clear();
    return result;
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

  async close(): Promise<void> {
    if (this.tabId !== undefined)
      await this.request(
        `${this.tab()}/close`,
        {},
        AbortSignal.timeout(10_000),
      );
  }
}
