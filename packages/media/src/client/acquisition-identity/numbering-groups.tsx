import { useId, useState } from "react";
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
import { Button } from "#client/ui/button.tsx";
import { Callout, LoadError } from "#client/ui/feedback.tsx";
import { SelectField, TextField } from "#client/ui/field.tsx";
import { Form } from "#client/ui/form.tsx";
import { EmptyNote, Panel, SkeletonRows } from "#client/ui/panel.tsx";
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
    <Panel
      title="Number a run from a TMDB episode group"
      description="TMDB lists some series in aired order as well as by season. Pick one of those lists and the release number of its first entry, then review every number before it is saved. Season and episode names in Plex stay as they are."
    >
      {open ? (
        <GroupChoice user={user} seriesId={seriesId} />
      ) : (
        <div>
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            Load episode groups
          </Button>
        </div>
      )}
    </Panel>
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
  const absolute = groups.data?.groups.filter((group) => group.type === 2);
  return (
    <>
      {groups.isPending && (
        <SkeletonRows label="Loading episode groups" rows={2} />
      )}
      {groups.error !== null && (
        <LoadError
          what="Episode groups"
          error={groups.error}
          retry={() => {
            void groups.refetch();
          }}
        />
      )}
      {absolute?.length === 0 && (
        <EmptyNote>
          TMDB has no aired-order group for this series. You can still set each
          episode’s number below.
        </EmptyNote>
      )}
      {absolute !== undefined && absolute.length > 0 && (
        <SelectField
          label="Aired-order group"
          value={groupId}
          onChange={(event) => {
            setGroupId(event.target.value);
          }}
        >
          <option value="">Choose a group</option>
          {absolute.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} ({group.episodeCount} episodes)
            </option>
          ))}
        </SelectField>
      )}
      {groupId !== "" && (
        <GroupInterpretation
          key={groupId}
          user={user}
          seriesId={seriesId}
          groupId={groupId}
        />
      )}
    </>
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
  const headingId = useId();
  const detail = useQuery({
    queryKey: ["numbering-group-detail", seriesId, groupId],
    queryFn: () =>
      readApi(
        `/admin/numbering/series/${seriesId}/groups/${encodeURIComponent(groupId)}`,
        NumberingGroupDetailSchema,
      ),
  });
  const preview = useMutation({
    mutationFn: (input: PreviewNumberingGroup) =>
      writeApi({
        actorId: user.id,
        path: `/admin/numbering/series/${seriesId}/group-preview`,
        body: input,
        schema: NumberingGroupPreviewSchema,
      }),
  });
  function submit(form: HTMLFormElement) {
    preview.reset();
    const fields = new FormData(form);
    preview.mutate(
      PreviewNumberingGroupSchema.parse({
        groupId,
        subgroupId: fields.get("subgroup"),
        firstAbsoluteNumber: Number(fields.get("first")),
        offset: 0,
      }),
    );
  }
  if (detail.isPending) {
    return <SkeletonRows label="Loading the group" rows={2} />;
  }
  if (detail.error !== null) {
    return (
      <LoadError
        what="The group"
        error={detail.error}
        retry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  return (
    <>
      <h3 className="sr-only" id={headingId}>
        Preview the numbers
      </h3>
      <Form
        labelledBy={headingId}
        onSubmit={submit}
        onEdit={() => {
          preview.reset();
        }}
      >
        <SelectField
          label="Part of the group"
          name="subgroup"
          required
          requiredMessage="Choose the part of the group to number."
          defaultValue=""
        >
          <option value="">Choose a part</option>
          {detail.data.subgroups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} (entries {group.firstOrder} to {group.lastOrder},{" "}
              {group.episodeCount} episodes)
            </option>
          ))}
        </SelectField>
        <TextField
          label="Release number of its first entry"
          description="The rest are numbered on from here, in the group’s order. The preview refuses a part with missing entries, numbers that clash, or episodes Media cannot identify."
          name="first"
          type="number"
          min="1"
          max="100000"
          step="1"
          required
          requiredMessage="Enter the first release number."
        />
        <div>
          <Button type="submit" variant="primary" busy={preview.isPending}>
            Preview the numbers
          </Button>
        </div>
      </Form>
      {preview.error !== null && (
        <Callout tone="danger">{preview.error.message}</Callout>
      )}
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
    </>
  );
}
