import { z } from "zod";

/** Nonsecret values copied exactly from the reserved Partner Center product. */
export const StoreIdentitySchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().regex(/^[A-Za-z0-9.-]{3,50}$/u),
  publisher: z.string().startsWith("CN=").min(4).max(8192),
  publisherDisplayName: z.string().min(1).max(256),
  displayName: z.string().min(1).max(256),
  version: z.string().regex(/^\d+\.\d+\.\d+\.0$/u),
});
export type StoreIdentity = z.infer<typeof StoreIdentitySchema>;

/** Fail before building when the real Store reservation is absent or substituted. */
export function parseStoreIdentity(value: unknown): StoreIdentity {
  const identity = StoreIdentitySchema.parse(value);
  if (
    identity.publisher === "CN=TaskNotes Development" ||
    /\p{Cc}/u.test(identity.publisher) ||
    identity.version.split(".").some((component) => Number(component) > 65_535)
  ) {
    throw new Error(
      "Use the exact registered Microsoft Store publisher and version.",
    );
  }
  return identity;
}

const xml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** Generate a distinct Store manifest; keep development identity and signing intact. */
export function storeManifest(source: string, identity: StoreIdentity): string {
  const identities = source.match(/<Identity\b[^>]*\/>/gu);
  if (identities?.length !== 1)
    throw new Error("Expected one development manifest identity.");
  return source
    .replaceAll(
      /<Identity\b[^>]*\/>/gu,
      `<Identity Name="${xml(identity.name)}" Publisher="${xml(identity.publisher)}" Version="${xml(identity.version)}" />`,
    )
    .replaceAll(
      /<PublisherDisplayName>[^<]*<\/PublisherDisplayName>/gu,
      `<PublisherDisplayName>${xml(identity.publisherDisplayName)}</PublisherDisplayName>`,
    )
    .replaceAll(
      /<DisplayName>[^<]*<\/DisplayName>/gu,
      `<DisplayName>${xml(identity.displayName)}</DisplayName>`,
    )
    .replaceAll(
      /\bDisplayName="[^"]*"/gu,
      `DisplayName="${xml(identity.displayName)}"`,
    );
}
