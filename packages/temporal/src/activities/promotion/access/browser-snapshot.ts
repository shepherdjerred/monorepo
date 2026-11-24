import { z } from "zod/v4";
import {
  promotionPublicUrl,
  redactPromotionUrls,
} from "#activities/promotion/redaction.ts";
import { PromotionBrowserHttpError } from "./browser-http-error.ts";
import { checkRedditAccountRead } from "./reddit-account.ts";
import type { PromotionBrowserOptions } from "./browser-profile.ts";

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
export type AccessibleNode = z.infer<typeof AccessibleNodeSchema>;
export type SnapshotScope = {
  selector?: string | undefined;
  depth?: number | undefined;
};

const IdpiBlockResponseSchema = z.object({
  error: z.string().startsWith("snapshot blocked by IDPI scanner:"),
});

export class PromotionSnapshotBlocked extends Error {
  constructor(
    readonly url: string,
    readonly selector: string | null,
  ) {
    super(
      `PinchTab content scanner blocked ${selector ?? "the page"} at ${url}`,
    );
    this.name = "PromotionSnapshotBlocked";
  }
}

function isPinchTabSnapshotBlock(status: number, detail: string) {
  if (status !== 403) return false;
  try {
    return IdpiBlockResponseSchema.safeParse(JSON.parse(detail)).success;
  } catch {
    return false;
  }
}

export async function readPromotionBrowserSnapshot(input: {
  url: string;
  scope: SnapshotScope | undefined;
  reddit: boolean;
  options: PromotionBrowserOptions;
  readSnapshot: (parameters: URLSearchParams) => Promise<unknown>;
  evaluate: (script: string) => Promise<unknown>;
}) {
  const { scope } = input;
  async function readScannedSnapshot(parameters: URLSearchParams) {
    try {
      return SnapshotSchema.parse(await input.readSnapshot(parameters));
    } catch (error) {
      if (
        error instanceof PromotionBrowserHttpError &&
        isPinchTabSnapshotBlock(error.status, error.detail)
      )
        throw new PromotionSnapshotBlocked(
          promotionPublicUrl(input.url),
          parameters.get("selector"),
        );
      throw error;
    }
  }
  // PinchTab's snapshot performs its content scanning/wrapping before data
  // enters an agent prompt. Keep that endpoint in the observation path.
  const parameters = new URLSearchParams({
    format: "json",
    ...(scope?.selector === undefined ? {} : { selector: scope.selector }),
    ...(scope?.depth === undefined ? {} : { depth: String(scope.depth) }),
  });
  const snapshot = await readScannedSnapshot(parameters);
  await checkRedditAccountRead({
    options: input.options,
    scan: () =>
      readScannedSnapshot(
        new URLSearchParams({ format: "json", selector: "body", depth: "3" }),
      ),
    evaluate: (script) => input.evaluate(script),
  });
  const times = await input.evaluate(
    "Array.from(document.querySelectorAll('time[datetime]')).map(e=>({datetime:e.getAttribute('datetime'),text:e.textContent}))",
  );
  const text = redactPromotionUrls(
    JSON.stringify({ snapshot, scope: scope ?? {}, timestamps: times }),
  );
  if (text.length > 120_000) {
    throw new Error(
      "Promotion page exceeds observation size limit; use a narrower page",
    );
  }
  const publishedAt = input.reddit
    ? z
        .string()
        .nullable()
        .parse(
          await input.evaluate(
            "(() => { const parts=location.pathname.split('/'); const index=parts.indexOf('comments'); const id=index<0?null:parts[index+1]; if(!id) return null; const old=document.querySelector('[data-fullname=\"t3_'+id+'\"] .tagline time[datetime]'); const modern=document.querySelector('shreddit-post[id=\"t3_'+id+'\"],shreddit-post[post-id=\"t3_'+id+'\"]'); return old?.getAttribute('datetime')||modern?.getAttribute('created-timestamp')||modern?.querySelector('time[datetime]')?.getAttribute('datetime')||null; })()",
          ),
        )
    : null;
  return { nodes: snapshot.nodes, text, publishedAt };
}
