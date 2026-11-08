import { MediaError } from "#application/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";

export function movieNoticeConfigurationError(error: unknown) {
  return error instanceof MediaError && error.code === "plex_scope_unconfigured"
    ? new PlexBindingProtection("wrong_section")
    : error;
}

export function assertMovieNoticeAccessUnchanged(
  access: MovieChoiceAccess | undefined,
  expected: MovieChoiceAccess,
) {
  if (identityHash(access) !== identityHash(expected))
    throw new PlexBindingProtection("wrong_section");
}
