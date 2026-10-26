import { MediaError } from "#application/errors.ts";
import type { PlexBindingReason } from "#shared/plex-binding/contract.ts";

export class PlexBindingProtection extends MediaError {
  constructor(readonly reason: PlexBindingReason) {
    super(reason, "Plex association requires a fresh exact verification", 409);
  }
}
