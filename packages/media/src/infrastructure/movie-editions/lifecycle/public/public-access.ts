import { MediaError } from "#application/errors.ts";
import {
  requireMovieProtectionAccess,
  type MovieChoiceAccess,
  type MovieProtectionAccess,
} from "#infrastructure/movie-editions/access.ts";
import type { MovieLifecycleCommandV4 } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";

export type MovieProtectionViewAccessV4 =
  | { access: MovieChoiceAccess; protection?: MovieProtectionAccess }
  | { access: null; protection: MovieProtectionAccess };

export function movieReadProtectionAccessV4(
  input: MovieProtectionViewAccessV4,
): MovieProtectionAccess {
  return input.access ?? input.protection;
}

/** A self hold needs its known server identity; acquisition requires complete current configured access. */
export async function captureMovieActionAccessV4(
  settings: { serverMachineId?: string | undefined },
  resolve: () => Promise<MovieChoiceAccess>,
  action: MovieLifecycleCommandV4["command"]["action"],
) {
  if (!["keep", "pin", "unpin"].includes(action)) {
    const choice = await resolve();
    return { protection: choice, choice };
  }
  const protection = requireMovieProtectionAccess(settings);
  try {
    return { protection, choice: await resolve() };
  } catch (error) {
    if (error instanceof MediaError && error.code === "plex_scope_unconfigured")
      return { protection, choice: null };
    throw error;
  }
}

export function requireMovieActionChoiceAccessV4(
  access: MovieChoiceAccess | null,
) {
  if (access === null)
    throw new MediaError(
      "plex_scope_unconfigured",
      "Movie library authorization is not configured",
      503,
    );
  return access;
}
