import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CommandResultSchema,
  ProfileListSchema,
  SaveQualityProfileSchema,
} from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient, readApi, writeApi } from "./api.ts";
import { ErrorNotice, Notice } from "./components.tsx";

export function AssignProfile({
  user,
  mediaId,
  version,
  currentId,
}: {
  user: MediaUser;
  mediaId: string;
  version: number;
  currentId: string | null;
}) {
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => readApi("/profiles", ProfileListSchema),
  });
  const [selected, setSelected] = useState(currentId ?? "");
  const save = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId: user.id,
        path: `/media/${encodeURIComponent(mediaId)}/profile`,
        method: "PUT",
        body: { profileId: selected, expectedVersion: version },
        schema: CommandResultSchema,
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["media", mediaId] }),
  });
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <label htmlFor="quality-profile">Quality profile</label>
      <select
        id="quality-profile"
        value={selected}
        onChange={(event) => {
          setSelected(event.target.value);
        }}
        required
      >
        <option value="" disabled>
          Select a profile
        </option>
        {profiles.data?.map((profile) => (
          <option value={profile.id} key={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
      <button
        className="button"
        type="submit"
        disabled={
          save.isPending || selected.length === 0 || selected === currentId
        }
      >
        Apply profile
      </button>
      {save.error !== null && <ErrorNotice error={save.error} />}
      {save.isSuccess && <Notice>Profile change queued for evaluation.</Notice>}
    </form>
  );
}

export function ProfileEditor({
  user,
  profile,
}: {
  user: MediaUser;
  profile: { id: string; name: string; version: number; rules: unknown } | null;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [rules, setRules] = useState(
    profile === null ? "" : JSON.stringify(profile.rules, null, 2),
  );
  const save = useMutation({
    mutationFn: async () => {
      const parsedRules: unknown = JSON.parse(rules);
      const body = SaveQualityProfileSchema.parse({
        ...(profile === null ? {} : { id: profile.id }),
        name,
        rules: parsedRules,
        expectedVersion: profile?.version ?? 0,
      });
      return writeApi({
        actorId: user.id,
        path: "/admin/profiles",
        body,
        schema: CommandResultSchema,
      });
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <label>
        Name
        <input
          aria-label="Profile name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          required
          maxLength={100}
        />
      </label>
      <label>
        Quality rules
        <textarea
          aria-label="Quality rules JSON"
          rows={12}
          value={rules}
          onChange={(event) => {
            setRules(event.target.value);
          }}
          required
          spellCheck={false}
        />
      </label>
      <p className="helper">
        Supply the validated quality rules JSON, including quality order, score
        minimum, cutoff, codec/audio constraints, and size bounds. Every save
        preserves the previous version.
      </p>
      <button className="button" type="submit" disabled={save.isPending}>
        {save.isPending
          ? "Saving…"
          : profile === null
            ? "Create profile"
            : "Save new version"}
      </button>
      {save.error !== null && <ErrorNotice error={save.error} />}
      {save.isSuccess && <Notice>Quality profile saved.</Notice>}
    </form>
  );
}
