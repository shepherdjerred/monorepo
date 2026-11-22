import { z } from "zod";
import { fetchJson, type Fetch } from "@shepherdjerred/ops-clients/http.ts";

export const GOLINK_TIERS = [
  "manual",
  "ingress",
  "site",
  "alias",
  "shortcut",
] as const;

export type GolinkTier = (typeof GOLINK_TIERS)[number];

const GolinkTierSchema = z.enum(GOLINK_TIERS);

const RawShadowSchema = z.object({
  kind: GolinkTierSchema.optional(),
  tier: GolinkTierSchema.optional(),
  targetUrl: z.string(),
  detail: z.string().optional(),
});

const RawLinkSchema = z.object({
  short: z.string().optional(),
  slug: z.string().optional(),
  targetUrl: z.string(),
  kind: GolinkTierSchema.optional(),
  tier: GolinkTierSchema.optional(),
  detail: z.string().optional(),
  clicks: z.number().int().nonnegative().optional(),
  lastClickedAt: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
  shadows: RawShadowSchema.optional(),
});

const LinksResponseSchema = z.object({
  links: z.array(RawLinkSchema),
  dynamicAliasesEnabled: z.boolean().optional(),
  writesEnabled: z.boolean().optional(),
});

export type GolinkShadow = {
  tier: GolinkTier;
  targetUrl: string;
  detail: string | undefined;
};

export type GolinkLink = {
  slug: string;
  targetUrl: string;
  tier: GolinkTier;
  clicks: number;
  shadows: GolinkShadow | undefined;
  detail?: string;
  lastClickedAt?: string | null;
  updatedAt?: string;
};

/** Read-only Golink `/api/links` directory client. */
export class GolinkClient {
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;
  readonly #fetch: Fetch;

  constructor(options: {
    baseUrl: string;
    headers?: Record<string, string>;
    fetch?: Fetch;
  }) {
    this.#baseUrl = options.baseUrl;
    this.#headers = options.headers ?? {};
    this.#fetch = options.fetch ?? fetch;
  }

  async listLinks(): Promise<GolinkLink[]> {
    const url = new URL("/api/links", this.#baseUrl);
    const body = await fetchJson(
      this.#fetch,
      {
        upstream: "golink",
        url,
        init: {
          headers: {
            accept: "application/json",
            ...this.#headers,
          },
        },
      },
      LinksResponseSchema,
    );

    return body.links.flatMap((item) => {
      const slug = (item.short ?? item.slug ?? "").trim();
      const tier = item.kind ?? item.tier;
      if (slug === "" || tier === undefined) {
        return [];
      }
      const shadowTier = item.shadows?.kind ?? item.shadows?.tier;
      const shadows: GolinkShadow | undefined =
        shadowTier === undefined || item.shadows === undefined
          ? undefined
          : {
              tier: shadowTier,
              targetUrl: item.shadows.targetUrl,
              detail: item.shadows.detail,
            };

      return [
        {
          slug,
          targetUrl: item.targetUrl,
          tier,
          clicks: item.clicks ?? 0,
          shadows,
          ...(item.detail === undefined ? {} : { detail: item.detail }),
          ...(item.lastClickedAt === undefined
            ? {}
            : { lastClickedAt: item.lastClickedAt }),
          ...(item.updatedAt === undefined
            ? {}
            : { updatedAt: item.updatedAt }),
        },
      ];
    });
  }

  async links(): Promise<GolinkLink[]> {
    return await this.listLinks();
  }
}
