import { useId } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CommandResultSchema, ProfileListSchema } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import { LoadError } from "#client/ui/feedback.tsx";
import { SelectField } from "#client/ui/forms/field.tsx";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";
import { SkeletonRows } from "#client/ui/panel.tsx";

/** The quality profiles the owner can assign. Shared by every reader of the list. */
export function useProfiles(enabled = true) {
  return useQuery({
    queryKey: ["profiles"],
    enabled,
    queryFn: async () => readApi("/profiles", ProfileListSchema),
  });
}

/**
 * Which quality profile decides the releases this title accepts. Saving
 * queues the title for evaluation against the new profile; it does not wait
 * for that evaluation.
 */
export function ProfileForm({
  user,
  mediaId,
  version,
  currentId,
  saved,
  onSaved,
  onEdit,
}: {
  user: MediaUser;
  mediaId: string;
  /** The version of the title this form was loaded at; the write names it. */
  version: number;
  currentId: string | null;
  /** What was saved, in words, kept by the page so it outlives a reload of the title. */
  saved: string | null;
  onSaved: (message: string) => void;
  onEdit: () => void;
}) {
  const headingId = useId();
  const profiles = useProfiles();
  const save = useMutation({
    mutationFn: async (profileId: string) =>
      writeApi({
        actorId: user.id,
        path: `/media/${encodeURIComponent(mediaId)}/profile`,
        method: "PUT",
        body: { profileId, expectedVersion: version },
        schema: CommandResultSchema,
      }),
    onSuccess: async () => {
      onSaved("Profile change queued for evaluation.");
      await queryClient.invalidateQueries({ queryKey: ["media", mediaId] });
    },
  });
  return (
    <>
      <h3 id={headingId}>Quality profile</h3>
      {profiles.isPending && <SkeletonRows label="Loading profiles" rows={1} />}
      {profiles.error !== null && (
        <LoadError
          what="Quality profiles"
          error={profiles.error}
          retry={() => {
            void profiles.refetch();
          }}
        />
      )}
      {profiles.data !== undefined && (
        <Form
          labelledBy={headingId}
          // Editing never resets the save: a reset would end `isPending`
          // while the request still runs, re-enabling Apply and dropping
          // its failure. The Manage forms leave the mutation alone the same
          // way; the next submit replaces its result.
          onEdit={onEdit}
          validate={(form) => {
            const chosen = new FormData(form).get("profileId");
            return chosen === currentId
              ? { profileId: "This profile is already assigned." }
              : {};
          }}
          onSubmit={(form) => {
            const chosen = new FormData(form).get("profileId");
            if (typeof chosen !== "string" || chosen === "") {
              throw new TypeError("Missing profileId");
            }
            save.mutate(chosen);
          }}
        >
          <SelectField
            label="Quality profile"
            hideLabel
            description="The profile decides which releases are good enough for this title. Changing it queues the title for evaluation."
            name="profileId"
            required
            requiredMessage="Choose a profile."
            defaultValue={currentId ?? ""}
            width="medium"
          >
            <option value="" disabled>
              Select a profile
            </option>
            {profiles.data.map((profile) => (
              <option value={profile.id} key={profile.id}>
                {profile.name}
              </option>
            ))}
          </SelectField>
          <FormFooter
            submitLabel="Apply profile"
            pendingLabel="Applying…"
            pending={save.isPending}
            saved={saved}
            error={save.error}
          />
        </Form>
      )}
    </>
  );
}
