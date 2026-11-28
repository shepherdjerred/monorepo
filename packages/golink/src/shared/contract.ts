import { z } from "zod";

export const LinkKindSchema = z.enum([
  "manual",
  "ingress",
  "site",
  "alias",
  "shortcut",
]);
export type LinkKind = z.infer<typeof LinkKindSchema>;

export const DynamicLinkKindSchema = z.enum([
  "ingress",
  "site",
  "alias",
  "shortcut",
]);
export type DynamicLinkKind = z.infer<typeof DynamicLinkKindSchema>;

export const ShadowedLinkSchema = z.object({
  kind: DynamicLinkKindSchema,
  targetUrl: z.string(),
  detail: z.string().optional(),
});
export type ShadowedLink = z.infer<typeof ShadowedLinkSchema>;

export const LinkItemSchema = z.object({
  short: z.string(),
  targetUrl: z.string(),
  kind: LinkKindSchema,
  detail: z.string().optional(),
  createdBy: z.string().optional(),
  clicks: z.number().int().nonnegative().optional(),
  lastClickedAt: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
  shadows: ShadowedLinkSchema.optional(),
});
export type LinkItem = z.infer<typeof LinkItemSchema>;

export const ShortcutSpecSchema = z.object({
  pattern: z.string(),
  exampleShort: z.string(),
  exampleTargetUrl: z.string(),
  description: z.string(),
});
export type ShortcutSpec = z.infer<typeof ShortcutSpecSchema>;

export const ViewerSchema = z.object({
  login: z.string().nullable(),
  displayName: z.string().nullable(),
});
export type Viewer = z.infer<typeof ViewerSchema>;

export const LinksDirectoryResponseSchema = z.object({
  viewer: ViewerSchema,
  dynamicAliasesEnabled: z.boolean(),
  writesEnabled: z.boolean(),
  links: z.array(LinkItemSchema),
  shortcuts: z.array(ShortcutSpecSchema),
});
export type LinksDirectoryResponse = z.infer<
  typeof LinksDirectoryResponseSchema
>;

export const RESERVED_SLUGS = new Set([
  "api",
  "assets",
  "healthz",
  "readyz",
  "metrics",
  "trpc",
  "favicon.ico",
  "robots.txt",
]);

export const SHORT_SLUG_PATTERN = String.raw`^[a-zA-Z0-9](?:[\w.-]{0,62}[a-zA-Z0-9])?$`;
const SHORT_SLUG_REGEX = new RegExp(SHORT_SLUG_PATTERN, "u");

export function normalizeShortSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateShortSlug(raw: string): string | null {
  const normalized = normalizeShortSlug(raw);
  if (normalized.length === 0) {
    return "Enter a short link name, such as docs or ha.";
  }
  if (normalized.startsWith(".")) {
    return "Short link names cannot start with a period.";
  }
  if (RESERVED_SLUGS.has(normalized)) {
    return `"${normalized}" is reserved for internal service routes.`;
  }
  return SHORT_SLUG_REGEX.test(normalized)
    ? null
    : "Use 1–64 letters, numbers, hyphens, underscores, or periods (starting and ending with a letter or number).";
}

export function validateTargetUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "Enter an http:// or https:// destination URL.";
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a complete URL starting with https:// or http://.";
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? null
    : "Destination URL must use https:// or http://.";
}

/** A slug as typed: normalized, then checked against the slug rules. */
export const ShortSlugSchema = z
  .string()
  .transform((value) => normalizeShortSlug(value))
  .superRefine((value, ctx) => {
    const error = validateShortSlug(value);
    if (error !== null) {
      ctx.addIssue({ code: "custom", message: error });
    }
  });

export const UpsertManualLinkInputSchema = z.object({
  short: ShortSlugSchema,
  targetUrl: z
    .string()
    .transform((value) => value.trim())
    .superRefine((value, ctx) => {
      const error = validateTargetUrl(value);
      if (error !== null) {
        ctx.addIssue({ code: "custom", message: error });
      }
    }),
});
export type UpsertManualLinkInput = z.infer<typeof UpsertManualLinkInputSchema>;
