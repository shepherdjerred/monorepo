import type { MediaAutomationContext } from "#automation/context.ts";
import {
  PlexAccessSchema,
  type PlexAccess,
} from "#shared/plex-binding/contract.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

/** Resolve only the requested library kinds, outside every publication transaction. */
export async function bindingAccess(
  context: Pick<MediaAutomationContext, "plexAccess">,
  kinds: readonly ("movie" | "show")[],
): Promise<PlexAccess[]> {
  const access: PlexAccess[] = [];
  for (const kind of [...new Set(kinds)].sort()) {
    const value = PlexAccessSchema.parse(await context.plexAccess(kind));
    if (value.sectionType !== kind) {
      throw new PlexBindingProtection("wrong_section");
    }
    access.push(value);
  }
  return access;
}
