import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CommandResultSchema, ProfileListSchema } from "#shared/api.ts";
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
