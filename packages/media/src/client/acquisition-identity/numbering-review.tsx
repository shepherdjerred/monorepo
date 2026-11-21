import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import {
  CommitNumberingGroupSchema,
  type NumberingGroupPreview,
  type PreviewNumberingGroup,
} from "#shared/acquisition/numbering.ts";
import { queryClient, writeApi } from "#client/api.ts";
import { Button, ButtonRow } from "#client/ui/button.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Callout } from "#client/ui/feedback.tsx";
import { CheckboxField, FieldGroup } from "#client/ui/field.tsx";

export function NumberingBatchReview({
  user,
  preview,
  next,
}: {
  user: MediaUser;
  preview: NumberingGroupPreview;
  next: (input: PreviewNumberingGroup) => void;
}) {
  const [overrides, setOverrides] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const commit = useMutation({
    mutationFn: () =>
      writeApi({
        actorId: user.id,
        path: `/admin/numbering/series/${preview.seriesId}/group-commit`,
        body: CommitNumberingGroupSchema.parse({
          interpretation: preview.interpretation,
          previewDigest: preview.previewDigest,
          groupDigest: preview.groupDigest,
          catalogDigest: preview.catalogDigest,
          numberingDigest: preview.numberingDigest,
          mappings: preview.mappings.map((mapping) => ({
            episodeId: mapping.episodeId,
            expectedVersion: mapping.expectedVersion,
            absoluteNumber: mapping.absoluteNumber,
          })),
          overrideEpisodeIds: overrides,
        }),
        schema: CommandResultSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["numbering-episodes"] });
    },
  });
  const unresolved = preview.mappings.some(
    (mapping) =>
      mapping.requiresOverride && !overrides.includes(mapping.episodeId),
  );
  return (
    <FieldGroup
      legend={`Review ${String(preview.mappings.length)} numbers`}
      description="Saving sets these numbers only. It does not request or download any of these episodes."
    >
      <DataList label="Numbers to save">
        {preview.mappings.map((mapping) => (
          <DataRow
            key={mapping.episodeId}
            title={`S${String(mapping.seasonNumber)} E${String(mapping.episodeNumber)}: ${mapping.title}`}
            detail={
              <>
                Entry {mapping.rawOrder} in the group becomes release number{" "}
                {mapping.absoluteNumber}. TMDB episode {mapping.tmdbEpisodeId}.{" "}
                {mapping.previousAbsoluteNumber === null
                  ? "It has no release number now."
                  : `Its release number now is ${String(mapping.previousAbsoluteNumber)}.`}
              </>
            }
          >
            {mapping.requiresOverride && (
              <>
                <CheckboxField
                  label="Replace this episode’s current number"
                  description="Tick this after reading the evidence recorded for the current number."
                  checked={overrides.includes(mapping.episodeId)}
                  disabled={commit.isSuccess}
                  onChange={(event) => {
                    setOverrides(
                      event.target.checked
                        ? [...overrides, mapping.episodeId]
                        : overrides.filter((id) => id !== mapping.episodeId),
                    );
                  }}
                />
                <details>
                  <summary>Evidence for the current number</summary>
                  <pre>
                    {JSON.stringify(mapping.existingProvenance, null, 2)}
                  </pre>
                </details>
              </>
            )}
          </DataRow>
        ))}
      </DataList>
      <CheckboxField
        label="I checked each episode against the release number it will get"
        checked={acknowledged}
        disabled={commit.isSuccess}
        onChange={(event) => {
          setAcknowledged(event.target.checked);
        }}
      />
      {commit.error !== null && (
        <Callout tone="danger">{commit.error.message}</Callout>
      )}
      {commit.isSuccess && (
        <Callout tone="ok">
          Numbers saved. Any download that was matched with an older number has
          to be reviewed again.
        </Callout>
      )}
      <ButtonRow>
        <Button
          variant="primary"
          busy={commit.isPending}
          disabled={unresolved || !acknowledged || commit.isSuccess}
          onClick={() => {
            commit.mutate();
          }}
        >
          Save these numbers
        </Button>
        {preview.nextOffset !== null && (
          <Button
            disabled={!commit.isSuccess}
            onClick={() => {
              if (preview.nextOffset !== null) {
                next({ ...preview.interpretation, offset: preview.nextOffset });
              }
            }}
          >
            Review the next batch
          </Button>
        )}
      </ButtonRow>
      <details>
        <summary>What this preview was made from</summary>
        <pre>
          {JSON.stringify(
            {
              groupDigest: preview.groupDigest,
              catalogDigest: preview.catalogDigest,
              numberingDigest: preview.numberingDigest,
              previewDigest: preview.previewDigest,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </FieldGroup>
  );
}
