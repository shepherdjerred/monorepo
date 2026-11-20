import {
  ManualSubtitleAdministration,
  ProviderAdministration,
} from "#client/admin.tsx";
import { PageTitle } from "#client/components.tsx";
import { NumberingAdministration } from "#client/numbering-admin.tsx";
import { PlexProfileAdministration } from "#client/plex-admin.tsx";
import { useUser } from "#client/shell/user.ts";

export function SubtitlesPage() {
  const user = useUser();
  return (
    <>
      <PageTitle title="Subtitles">
        <p>Add a subtitle file to a video, or replace one that is installed.</p>
      </PageTitle>
      <ManualSubtitleAdministration user={user} />
    </>
  );
}

export function PlexPage() {
  const user = useUser();
  return (
    <>
      <PageTitle title="Plex">
        <p>Match the people in your Plex Home to their accounts here.</p>
      </PageTitle>
      <PlexProfileAdministration user={user} />
    </>
  );
}

export function NumberingPage() {
  const user = useUser();
  return (
    <>
      <PageTitle title="Numbering">
        <p>Correct how a release’s episode numbers map to a series.</p>
      </PageTitle>
      <NumberingAdministration user={user} />
    </>
  );
}

export function ProvidersPage() {
  const user = useUser();
  return (
    <>
      <PageTitle title="Providers and seeding">
        <p>
          Where releases and subtitles come from, and how long each download
          keeps seeding.
        </p>
      </PageTitle>
      <ProviderAdministration user={user} />
    </>
  );
}
