import { useState, type SyntheticEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import {
  NumberingGroupListSchema,
  NumberingGroupDetailSchema,
  NumberingGroupPreviewSchema,
  PreviewNumberingGroupSchema,
  type PreviewNumberingGroup,
} from "#shared/acquisition/numbering.ts";
import { readApi, writeApi } from "#client/api.ts";
import { ErrorNotice, Loading } from "#client/components.tsx";
import { NumberingBatchReview } from "./numbering-review.tsx";

export function NumberingGroups({
  user,
  seriesId,
}: {
  user: MediaUser;
  seriesId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel stack-form">
      <h3>Use a TMDB episode group</h3>
      <p>
        Review an absolute-order subgroup and choose its first release number.
        Canonical Plex season and episode names stay the same.
      </p>
      {open ? (
        <GroupChoice user={user} seriesId={seriesId} />
      ) : (
        <button
          className="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Load episode groups
        </button>
      )}
    </section>
  );
}
function GroupChoice({
  user,
  seriesId,
}: {
  user: MediaUser;
  seriesId: string;
}) {
  const [groupId, setGroupId] = useState("");
  const groups = useQuery({
    queryKey: ["numbering-groups", seriesId],
    queryFn: () =>
      readApi(
        `/admin/numbering/series/${seriesId}/groups`,
        NumberingGroupListSchema,
      ),
  });
  return (
    <div className="stack-form">
      {groups.isPending && <Loading />}
      {groups.error !== null && <ErrorNotice error={groups.error} />}
      <label>
        Absolute-order group
        <select
          value={groupId}
          onChange={(event) => {
            setGroupId(event.target.value);
          }}
        >
          <option value="">Choose a group</option>
          {groups.data?.groups
            .filter((group) => group.type === 2)
            .map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} · {group.episodeCount} episodes
              </option>
            ))}
        </select>
      </label>
      {groups.data !== undefined &&
        !groups.data.groups.some((group) => group.type === 2) && (
          <p>
            No absolute-order groups are available. Existing manual mappings can
            still be reviewed below.
          </p>
        )}
      {groupId !== "" && (
        <GroupInterpretation
          key={groupId}
          user={user}
          seriesId={seriesId}
          groupId={groupId}
        />
      )}
    </div>
  );
}
function GroupInterpretation({
  user,
  seriesId,
  groupId,
}: {
  user: MediaUser;
  seriesId: string;
  groupId: string;
}) {
  const detail = useQuery({
    queryKey: ["numbering-group-detail", seriesId, groupId],
    queryFn: () =>
      readApi(
        `/admin/numbering/series/${seriesId}/groups/${encodeURIComponent(groupId)}`,
        NumberingGroupDetailSchema,
      ),
  });
  const [error, setError] = useState<Error | null>(null);
  const preview = useMutation({
    mutationFn: (input: PreviewNumberingGroup) =>
      writeApi({
        actorId: user.id,
        path: `/admin/numbering/series/${seriesId}/group-preview`,
        body: input,
        schema: NumberingGroupPreviewSchema,
      }),
  });
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    preview.reset();
    const form = new FormData(event.currentTarget);
    const parsed = PreviewNumberingGroupSchema.safeParse({
      groupId,
      subgroupId: form.get("subgroup"),
      firstAbsoluteNumber: Number(form.get("first")),
      offset: 0,
    });
    if (!parsed.success) {
      setError(
        new Error("Choose a subgroup and a positive first release number."),
      );
      return;
    }
    preview.mutate(parsed.data);
  }
  if (detail.isPending) return <Loading />;
  if (detail.error !== null) return <ErrorNotice error={detail.error} />;
  return (
    <div className="stack-form">
      <form
        className="stack-form"
        onSubmit={submit}
        onChange={() => {
          preview.reset();
        }}
      >
        <label>
          Subgroup
          <select name="subgroup" required defaultValue="">
            <option value="">Choose a subgroup</option>
            {detail.data.subgroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} · source order {group.firstOrder}–{group.lastOrder}{" "}
                · {group.episodeCount} episodes
              </option>
            ))}
          </select>
        </label>
        <label>
          Release number for the first source entry
          <input
            name="first"
            type="number"
            min="1"
            max="100000"
            step="1"
            required
          />
        </label>
        <p>
          The preview applies your chosen first number to this subgroup’s source
          ordering. It will reject missing entries, conflicting mappings or
          unknown episode identities.
        </p>
        <button className="button" disabled={preview.isPending}>
          Preview exact mappings
        </button>
      </form>
      {error !== null && <ErrorNotice error={error} />}
      {preview.error !== null && <ErrorNotice error={preview.error} />}
      {preview.data !== undefined && (
        <NumberingBatchReview
          key={preview.data.previewDigest}
          user={user}
          preview={preview.data}
          next={(input) => {
            preview.mutate(input);
          }}
        />
      )}
    </div>
  );
}
