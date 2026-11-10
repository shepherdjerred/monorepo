import type { CredentialCipher } from "#application/security.ts";
import type { Database } from "#infrastructure/database.ts";
import type { mediaBehaviorConfig } from "#infrastructure/config.ts";
import { PlexPinAuthentication } from "#infrastructure/plex-auth.ts";
import { requesterAccessRefresher } from "#infrastructure/requester-access/refresh.ts";

export function createRequesterAccessRefresh(
  db: Database,
  cipher: CredentialCipher,
  behavior: ReturnType<typeof mediaBehaviorConfig>,
  settings: {
    serverUrl: string;
    serverMachineId: string;
    publicOrigin: string;
  },
) {
  return requesterAccessRefresher(
    db,
    cipher,
    async (execution) => {
      const [movie, tv] = await Promise.all([
        behavior.get("permittedMovieSectionId"),
        behavior.get("permittedTvSectionId"),
      ]);
      execution.assertActive();
      return new PlexPinAuthentication(
        {
          ...settings,
          permittedMovieSectionId: movie.value,
          permittedTvSectionId: tv.value,
          applicationName: "Media",
          returnUrl: new URL("/", settings.publicOrigin).toString(),
        },
        (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              execution.signal,
              ...(init?.signal === undefined || init.signal === null
                ? []
                : [init.signal]),
            ]),
          }),
      );
    },
    settings,
  );
}
