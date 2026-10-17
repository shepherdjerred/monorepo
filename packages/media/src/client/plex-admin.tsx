import { useState, type SyntheticEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import {
  PlexProfilesSchema,
  SavePlexProfileSchema,
  type PlexProfiles,
  type SavePlexProfile,
} from "#shared/plex-admin.ts";
import { queryClient, readApi, writeApi } from "./api.ts";
import { ErrorNotice, Loading, Notice } from "./components.tsx";

function ProfileMapping({
  user,
  profile,
  data,
}: {
  user: MediaUser;
  profile: PlexProfiles["homeUsers"][number];
  data: PlexProfiles;
}) {
  const mapping = data.mappings.find(
    (row) => row.globalAccountId === profile.id,
  );
  const [error, setError] = useState<Error | null>(null);
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
      await queryClient.invalidateQueries({ queryKey: ["plex-profiles"] });
    },
  });
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      save.mutate(
        SavePlexProfileSchema.parse({
          homeUserId: profile.id,
          serverAccountId: form.get("serverAccountId"),
          expectedVersion: mapping?.version ?? null,
          confirmedIdentity: form.get("confirmed") === "on",
          ...(profile.protected ? { pin: form.get("pin") } : {}),
        }),
      );
    } catch {
      setError(
        new Error(
          "Select the exact server account and confirm the identity mapping.",
        ),
      );
    }
  }
  return (
    <form className="panel stack-form" onSubmit={submit}>
      <h3>{profile.title}</h3>
      <p>
        Plex Home ID {profile.id} ·{" "}
        {profile.restricted ? "Managed profile" : "Independent account"}
      </p>
      {mapping !== undefined && (
        <p>
          Permitted library IDs:{" "}
          {mapping.permittedSectionIds.join(", ") || "none"}. Last verified:{" "}
          {mapping.verifiedAt === null
            ? "never"
            : new Date(mapping.verifiedAt).toLocaleString()}
          .
        </p>
      )}
      <label>
        Server-local account
        <select
          name="serverAccountId"
          defaultValue={mapping?.serverAccountId ?? ""}
          required
        >
          <option value="" disabled>
            Select the matching account ID
          </option>
          {data.serverAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} — server ID {account.id}
            </option>
          ))}
        </select>
      </label>
      {profile.protected && (
        <label>
          Plex Home PIN
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            minLength={4}
            maxLength={4}
            autoComplete="off"
            required
          />
        </label>
      )}
      <label>
        <input name="confirmed" type="checkbox" required /> I verified these IDs
        identify the same person. Names alone are not evidence.
      </label>
      <small>
        Connecting a managed profile creates no independent sign-in. Requests
        remain attributable to the owner and profile. Watch observations use the
        profile&apos;s scoped token.
      </small>
      {error !== null && <ErrorNotice error={error} />}
      {save.error !== null && <ErrorNotice error={save.error} />}
      {save.isSuccess && (
        <Notice>Profile mapped and permitted libraries verified.</Notice>
      )}
      <button className="button" disabled={save.isPending}>
        {save.isPending ? "Verifying…" : "Verify and save mapping"}
      </button>
    </form>
  );
}

export function PlexProfileAdministration({ user }: { user: MediaUser }) {
  const profiles = useQuery({
    queryKey: ["plex-profiles"],
    queryFn: async () => readApi("/admin/plex/profiles", PlexProfilesSchema),
  });
  return (
    <section aria-labelledby="plex-profiles-heading">
      <h2 id="plex-profiles-heading">Plex identities and Home profiles</h2>
      <p>
        Match stable Plex Home IDs to server-local account IDs. Duplicate
        display names are never matched automatically. Independent accounts must
        sign in first.
      </p>
      {profiles.isPending && <Loading />}
      {profiles.error !== null && <ErrorNotice error={profiles.error} />}
      {profiles.data !== undefined && (
        <div className="item-list">
          {profiles.data.homeUsers.map((profile) => (
            <ProfileMapping
              key={`${profile.id}:${String(profiles.data.mappings.find((row) => row.globalAccountId === profile.id)?.version ?? "new")}`}
              user={user}
              profile={profile}
              data={profiles.data}
            />
          ))}
        </div>
      )}
    </section>
  );
}
