import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProfileListSchema, type ProfileList } from "#shared/api.ts";
import { readApi } from "#client/api.ts";
import { Badge, Callout, LoadError } from "#client/ui/feedback.tsx";
import { useSavedNotes } from "#client/ui/forms/form.tsx";
import {
  Disclosure,
  DisclosureList,
  EmptyNote,
  Panel,
  SkeletonRows,
} from "#client/ui/panel.tsx";
import { ProfileForm } from "./profile-form.tsx";
import { blankProfile, readProfile } from "./profile-model.ts";

type Profile = ProfileList[number];
type Notes = ReturnType<typeof useSavedNotes>;

function ProfileRow({ profile, notes }: { profile: Profile; notes: Notes }) {
  const headingId = useId();
  const read = readProfile(profile);
  return (
    <Disclosure
      title={profile.name}
      titleId={headingId}
      meta={
        <>
          {read.kind === "managed" && <Badge>Follows the guide</Badge>}
          {read.kind === "unreadable" && (
            <Badge tone="danger">Cannot be read</Badge>
          )}
          <span>Version {profile.version}</span>
        </>
      }
    >
      {read.kind === "managed" && (
        <p>
          This profile is kept in step with the living-room guide, so it is
          changed there: preview the guide in{" "}
          <a href="#quality-guide">Living-room guide</a> to keep its guide
          revision and your score overrides.
        </p>
      )}
      {read.kind === "unreadable" && (
        <Callout tone="danger" title="This profile cannot be edited here">
          <p>
            Its rules hold something this page does not understand, so no form
            is shown and nothing has been changed. The profile itself is still
            in use.
          </p>
          <ul>
            {read.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Callout>
      )}
      {read.kind === "editable" && (
        <ProfileForm
          // A saved profile comes back with a new version; start again from it.
          key={profile.version}
          headingId={headingId}
          identity={{ id: profile.id, version: profile.version }}
          initial={read.state}
          saved={notes.note(profile.id)}
          onSaved={(message) => {
            notes.saved(profile.id, message);
          }}
          onEdit={() => {
            notes.edited(profile.id);
          }}
        />
      )}
    </Disclosure>
  );
}

const NEW_PROFILE = "new";

/** The form for a profile that does not exist yet, cleared after each one made. */
function NewProfile({ notes }: { notes: Notes }) {
  const headingId = useId();
  const [made, setMade] = useState(0);
  return (
    <Disclosure title="Start a new profile" titleId={headingId}>
      <ProfileForm
        key={made}
        headingId={headingId}
        identity={null}
        initial={blankProfile()}
        saved={notes.note(NEW_PROFILE)}
        onSaved={(message) => {
          notes.saved(NEW_PROFILE, message);
          setMade((count) => count + 1);
        }}
        onEdit={() => {
          notes.edited(NEW_PROFILE);
        }}
      />
    </Disclosure>
  );
}

export function ProfileSections() {
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => readApi("/profiles", ProfileListSchema),
  });
  const notes = useSavedNotes();
  return (
    <>
      <Panel
        title="Profiles"
        description="A profile says which releases are good enough for a title and when to stop looking for a better one. Saving a profile makes a new version of it."
      >
        {profiles.isPending && (
          <SkeletonRows label="Loading profiles" rows={4} />
        )}
        {profiles.error !== null && (
          <LoadError
            what="Profiles"
            error={profiles.error}
            retry={() => {
              void profiles.refetch();
            }}
          />
        )}
        {profiles.data?.length === 0 && (
          <EmptyNote>
            There are no profiles yet. Create the living-room profile above, or
            start one of your own below.
          </EmptyNote>
        )}
        {profiles.data !== undefined && profiles.data.length > 0 && (
          <DisclosureList>
            {profiles.data.map((profile) => (
              <ProfileRow key={profile.id} profile={profile} notes={notes} />
            ))}
          </DisclosureList>
        )}
      </Panel>
      <Panel
        title="New profile"
        description="For rules of your own. The living-room profiles are made from the guide instead."
      >
        <DisclosureList>
          <NewProfile notes={notes} />
        </DisclosureList>
      </Panel>
    </>
  );
}
