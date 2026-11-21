import { useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CommandResultSchema } from "#shared/api.ts";
import {
  PlexProfilesSchema,
  SavePlexProfileSchema,
  type PlexProfiles,
  type SavePlexProfile,
} from "#shared/plex-admin.ts";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import { PageTitle, dateLabel } from "#client/components.tsx";
import { useUser } from "#client/shell/user.ts";
import { ConfirmDialog } from "#client/ui/confirm-dialog.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, LoadError } from "#client/ui/feedback.tsx";
import { SelectField, TextField } from "#client/ui/field.tsx";
import { Form, FormFooter, useSavedNotes } from "#client/ui/form.tsx";
import { EmptyNote, Section, SkeletonRows } from "#client/ui/section.tsx";

type HomeProfile = PlexProfiles["homeUsers"][number];
type Mapping = PlexProfiles["mappings"][number];

/** What the form held when it was submitted, until the match is confirmed. */
type PendingMatch = Omit<SavePlexProfile, "confirmedIdentity">;

function mappingFor(data: PlexProfiles, profile: HomeProfile) {
  return data.mappings.find((row) => row.globalAccountId === profile.id);
}

function MatchFacts({ mapping }: { mapping: Mapping | undefined }) {
  if (mapping === undefined) {
    return <>Not matched to an account on this server yet.</>;
  }
  return (
    <>
      Matched to server account {mapping.serverAccountId ?? "none"}. Library IDs
      this person may open: {mapping.permittedSectionIds.join(", ") || "none"}.{" "}
      {mapping.verifiedAt === null
        ? "Never verified."
        : `Last verified ${dateLabel(mapping.verifiedAt)}.`}
    </>
  );
}

function ProfileMatch({
  profile,
  data,
  saved,
  onSaved,
  onEdit,
}: {
  profile: HomeProfile;
  data: PlexProfiles;
  saved: string | null;
  onSaved: (message: string) => void;
  onEdit: () => void;
}) {
  const user = useUser();
  const titleId = useId();
  const mapping = mappingFor(data, profile);
  const dialog = useRef<HTMLDialogElement>(null);
  // The PIN is part of this, so it stays out of rendered state.
  const pending = useRef<PendingMatch | null>(null);
  const [accountId, setAccountId] = useState("");
  const [invalid, setInvalid] = useState<Error | null>(null);
  const account = data.serverAccounts.find((entry) => entry.id === accountId);
  const save = useMutation({
    mutationFn: async (input: SavePlexProfile) =>
      writeApi({
        actorId: user.id,
        path: "/admin/plex/profiles",
        method: "PUT",
        body: input,
        schema: CommandResultSchema,
        sensitive: true,
      }),
    onSuccess: async () => {
      onSaved(
        `${profile.title} is matched to ${account?.name ?? "the chosen account"}, and their libraries were verified.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["plex-profiles"] });
    },
  });
  function review(form: HTMLFormElement) {
    const fields = new FormData(form);
    const serverAccountId = fields.get("serverAccountId");
    const pin = fields.get("pin");
    if (typeof serverAccountId !== "string") {
      throw new TypeError("Missing serverAccountId");
    }
    pending.current = {
      homeUserId: profile.id,
      serverAccountId,
      expectedVersion: mapping?.version ?? null,
      ...(typeof pin === "string" && profile.protected ? { pin } : {}),
    };
    setInvalid(null);
    save.reset();
    setAccountId(serverAccountId);
    dialog.current?.showModal();
  }
  function confirm() {
    const match = pending.current;
    pending.current = null;
    const input = SavePlexProfileSchema.safeParse({
      ...match,
      confirmedIdentity: true,
    });
    if (!input.success) {
      setInvalid(
        new Error(
          "That match was not sent. Choose the account again and check the PIN.",
        ),
      );
      return;
    }
    save.mutate(input.data);
  }
  return (
    <DataRow
      title={<span id={titleId}>{profile.title}</span>}
      detail={
        <>
          <p>
            Plex Home ID {profile.id}.{" "}
            {profile.restricted
              ? "A managed profile, without a Plex account of its own."
              : "Has its own Plex account."}
          </p>
          <p>
            <MatchFacts mapping={mapping} />
          </p>
        </>
      }
      status={
        <>
          {profile.protected && <Badge>PIN protected</Badge>}
          {mapping === undefined ? (
            <Badge tone="warn">Not matched</Badge>
          ) : (
            <Badge tone="ok">Matched</Badge>
          )}
        </>
      }
    >
      <Form labelledBy={titleId} onSubmit={review} onEdit={onEdit}>
        <SelectField
          label="Account on this server"
          name="serverAccountId"
          defaultValue={mapping?.serverAccountId ?? ""}
          required
          requiredMessage="Choose the account that belongs to this person."
          width="medium"
        >
          <option value="" disabled>
            Choose an account
          </option>
          {data.serverAccounts.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} (server ID {entry.id})
            </option>
          ))}
        </SelectField>
        {profile.protected && (
          <TextField
            label="Plex Home PIN"
            description="The four digits this profile is locked with."
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            minLength={4}
            maxLength={4}
            autoComplete="off"
            required
            requiredMessage="Enter this profile’s PIN."
            patternMessage="Enter the four digits of the PIN."
            width="short"
          />
        )}
        <FormFooter
          submitLabel="Verify and save match"
          pendingLabel="Verifying…"
          pending={save.isPending}
          saved={saved}
          error={invalid ?? save.error}
        />
      </Form>
      <ConfirmDialog
        ref={dialog}
        title={`Match ${profile.title} to ${account?.name ?? "this account"}?`}
        confirmLabel="Same person, save match"
        onConfirm={confirm}
        onCancel={() => {
          pending.current = null;
        }}
      >
        <p>
          Plex Home ID <strong>{profile.id}</strong> will be tied to the server
          account <strong>{account?.name}</strong> (server ID{" "}
          <strong>{accountId}</strong>).
        </p>
        <p>
          Confirm only if you have checked that both IDs belong to the same
          person. A matching name is not evidence.
        </p>
      </ConfirmDialog>
    </DataRow>
  );
}

export function PlexPage() {
  const profiles = useQuery({
    queryKey: ["plex-profiles"],
    queryFn: async () => readApi("/admin/plex/profiles", PlexProfilesSchema),
  });
  const notes = useSavedNotes();
  return (
    <>
      <PageTitle title="Plex">
        <p>Match the people in your Plex Home to their accounts here.</p>
      </PageTitle>
      <Section
        title="Plex Home profiles"
        description={
          <>
            <p>
              Each person is matched by ID, never by name, because names can
              repeat. Someone with their own Plex account has to sign in here
              once before they can be matched.
            </p>
            <p>
              Matching a managed profile does not give it a sign-in of its own.
              Its requests are recorded against you and the profile, and its
              watch history is read with the profile’s own token.
            </p>
          </>
        }
      >
        {profiles.isPending && (
          <SkeletonRows label="Loading Plex Home profiles" rows={3} tall />
        )}
        {profiles.error !== null && (
          <LoadError
            what="Plex Home profiles"
            error={profiles.error}
            retry={() => {
              void profiles.refetch();
            }}
          />
        )}
        {profiles.data?.homeUsers.length === 0 && (
          <EmptyNote>
            Your Plex Home has no profiles. Add people to your Plex Home in
            Plex, then come back to match them.
          </EmptyNote>
        )}
        {profiles.data !== undefined && profiles.data.homeUsers.length > 0 && (
          <DataList label="Plex Home profiles">
            {profiles.data.homeUsers.map((profile) => (
              <ProfileMatch
                key={`${profile.id}:${String(mappingFor(profiles.data, profile)?.version ?? "new")}`}
                profile={profile}
                data={profiles.data}
                saved={notes.note(profile.id)}
                onSaved={(message) => {
                  notes.saved(profile.id, message);
                }}
                onEdit={() => {
                  notes.edited(profile.id);
                }}
              />
            ))}
          </DataList>
        )}
      </Section>
    </>
  );
}
