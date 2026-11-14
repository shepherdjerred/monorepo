import { z } from "zod";

/**
 * The surface a conversation was started on. Server-owned and closed: the
 * database CHECKs the same set, and readers parse it strictly.
 */
export const ExploreConversationOriginSchema = z.enum([
  "legacy",
  "web",
  "discord",
  "voice",
  "desktop",
]);
export type ExploreConversationOrigin = z.infer<
  typeof ExploreConversationOriginSchema
>;

/**
 * The origin as a reader that predates Scout Desktop knows it.
 *
 * A browser tab keeps its bundle for as long as it stays open and parses a
 * transcript strictly, so an origin its enum has never heard of makes the
 * whole conversation unreadable there. A desktop conversation is a private
 * owner conversation exactly like a web one, so an older reader is told
 * `web`. Readers opt in to the real value by declaring the newer version.
 */
export function exploreOriginForPreDesktopReader(
  origin: ExploreConversationOrigin,
): Exclude<ExploreConversationOrigin, "desktop"> {
  return origin === "desktop" ? "web" : origin;
}
