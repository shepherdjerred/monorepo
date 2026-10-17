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
import { ErrorNotice, Notice } from "#client/components.tsx";

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
    <section className="stack-form">
      <h4>Review {preview.mappings.length} exact mappings</h4>
      <p>
        This saves numbering only. It does not request or download these
        episodes.
      </p>
      {preview.mappings.map((mapping) => (
        <div className="asset-card" key={mapping.episodeId}>
          <strong>
            S{mapping.seasonNumber} E{mapping.episodeNumber}: {mapping.title}
          </strong>
          <p>
            Source order {mapping.rawOrder} → release number{" "}
            {mapping.absoluteNumber}
          </p>
          <p className="helper">
            TMDB episode {mapping.tmdbEpisodeId}
            {mapping.previousAbsoluteNumber === null
              ? " · No existing absolute mapping"
              : ` · Current release number ${String(mapping.previousAbsoluteNumber)}`}
          </p>
          {mapping.requiresOverride && (
            <label className="checkbox-label">
              <input
                type="checkbox"
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
              Replace this existing mapping after reviewing its evidence.
            </label>
          )}
          {mapping.requiresOverride && (
            <details>
              <summary>Existing mapping evidence</summary>
              <pre>{JSON.stringify(mapping.existingProvenance, null, 2)}</pre>
            </details>
          )}
        </div>
      ))}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={commit.isSuccess}
          onChange={(event) => {
            setAcknowledged(event.target.checked);
          }}
        />
        I checked each canonical episode and proposed release number.
      </label>
      <button
        className="button button-primary"
        disabled={
          unresolved || !acknowledged || commit.isPending || commit.isSuccess
        }
        onClick={() => {
          commit.mutate();
        }}
      >
        Save these mappings
      </button>
      {commit.error !== null && <ErrorNotice error={commit.error} />}
      {commit.isSuccess && (
        <Notice>
          Mappings saved. Any acquisition using an older mapping must be
          reviewed again.
        </Notice>
      )}
      {preview.nextOffset !== null && (
        <button
          className="button"
          disabled={!commit.isSuccess}
          onClick={() => {
            if (preview.nextOffset !== null)
              next({ ...preview.interpretation, offset: preview.nextOffset });
          }}
        >
          Review next batch
        </button>
      )}
      <details>
        <summary>Snapshot evidence</summary>
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
    </section>
  );
}
