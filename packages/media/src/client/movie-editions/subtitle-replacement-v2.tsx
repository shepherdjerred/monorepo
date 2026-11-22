import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import {
  MovieSubtitleTargetV2Schema,
  type MovieSubtitleTargetV2,
} from "#shared/movie-editions/subtitle-target-v2.ts";
import { MoviePrepareReplacementV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import {
  movieEditionDisplayLabel,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { readApi } from "#client/api.ts";
import { CommandFailure } from "#client/subtitle-replacement/failure.tsx";
import { Callout, LoadError } from "#client/ui/feedback.tsx";
import { SelectField } from "#client/ui/forms/field.tsx";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";
import { Disclosure } from "#client/ui/panel.tsx";
import { MovieCaptionUploadV2 } from "./subtitle-upload-v2.tsx";
import { useMovieCaptionCommandV2 } from "./subtitle-api-v2.ts";

/**
 * Replace one installed caption of a published movie edition: pick the
 * caption, upload or choose a validated candidate, and prepare a review. The
 * replacement itself is approved on the review page.
 */
export function MovieCaptionReplacementV2({
  user,
  context,
}: {
  user: MediaUser;
  context: Extract<MovieTargetContextV4, { access: "detail" }>;
}) {
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<{
    id: string;
    scope: MovieEditionScope;
  } | null>(null);
  const [selected, setSelected] = useState<{
    context: MovieSubtitleTargetV2;
    oldId: string;
  } | null>(null);
  const target = useQuery({
    queryKey: [
      "movie-subtitle-target",
      context.scope.mediaId,
      context.scope.edition,
    ],
    enabled: open && user.role === "owner" && prepared === null,
    queryFn: () =>
      readApi(
        `/media/${context.scope.mediaId}/movie-editions/${context.scope.edition}/subtitle-target`,
        MovieSubtitleTargetV2Schema.refine(
          (value) =>
            value.scope.mediaId === context.scope.mediaId &&
            value.scope.edition === context.scope.edition,
          "Caption target belongs to another edition",
        ),
        2,
      ),
  });
  if (user.role !== "owner" || context.currentAsset?.state !== "published")
    return null;
  const old = selected?.context.subtitles.find(
    (caption) => caption.id === selected.oldId,
  );
  if (prepared !== null)
    return (
      <Callout tone="ok">
        <span role="status">
          Review prepared for {movieEditionDisplayLabel(prepared.scope.edition)}
          .{" "}
        </span>
        <Link to={`/manage/subtitles/replacements/${prepared.id}`}>
          Inspect and approve the exact replacement
        </Link>
      </Callout>
    );
  return (
    <Disclosure
      title={`Replace captions for ${context.editionLabel}`}
      onToggle={setOpen}
    >
      <p>
        Choose the installed caption to replace. Uploading or choosing a
        candidate and preparing a review replaces nothing; you approve the exact
        replacement on the review page.
      </p>
      {target.isPending && open && <p role="status">Loading captions…</p>}
      {target.error !== null && (
        <LoadError
          what="Captions"
          error={target.error}
          retry={() => {
            void target.refetch();
          }}
        />
      )}
      {target.data !== undefined && (
        <SelectField
          label="Installed sidecar"
          value={selected?.oldId ?? ""}
          onChange={(event) => {
            const value = target.data;
            setSelected({ context: value, oldId: event.target.value });
          }}
        >
          <option value="">Choose the exact caption…</option>
          {target.data.subtitles
            .filter(
              (caption) =>
                caption.state === "installed" &&
                caption.storageKind === "sidecar" &&
                ["en", "zh-Hans"].includes(caption.language),
            )
            .map((caption) => (
              <option key={caption.id} value={caption.id}>
                {caption.language}: {caption.filename}
              </option>
            ))}
        </SelectField>
      )}
      {selected !== null && old !== undefined && (
        <div key={`${old.id}:${String(old.version)}`}>
          <MovieCaptionUploadV2
            user={user}
            context={selected.context}
            old={old}
            refresh={() => {
              setSelected(null);
              void target.refetch();
            }}
          />
          {target.data !== undefined && (
            <MovieCaptionPrepareV2
              user={user}
              reviewed={selected.context}
              oldId={old.id}
              candidates={target.data}
              onPrepared={(id, scope) => {
                setPrepared({ id, scope });
              }}
              refresh={() => {
                setSelected(null);
                void target.refetch();
              }}
            />
          )}
        </div>
      )}
    </Disclosure>
  );
}

function MovieCaptionPrepareV2({
  user,
  reviewed,
  oldId,
  candidates,
  refresh,
  onPrepared,
}: {
  user: MediaUser;
  reviewed: MovieSubtitleTargetV2;
  oldId: string;
  candidates: MovieSubtitleTargetV2;
  refresh: () => void;
  onPrepared: (id: string, scope: MovieEditionScope) => void;
}) {
  const headingId = useId();
  const [candidateId, setCandidateId] = useState("");
  const command = useMovieCaptionCommandV2(user.id, { onPrepared });
  const old = reviewed.subtitles.find((caption) => caption.id === oldId);
  if (old === undefined)
    throw new Error("Reviewed caption left its exact video context");
  const candidate = candidates.subtitles.find(
    (caption) => caption.id === candidateId,
  );
  return (
    <>
      <h4 id={headingId}>Prepare the replacement review</h4>
      <Form
        labelledBy={headingId}
        onSubmit={() => {
          if (candidate === undefined) return;
          command.submit({
            path: `/media/${reviewed.scope.mediaId}/movie-editions/${reviewed.scope.edition}/subtitle-replacements`,
            body: MoviePrepareReplacementV2Schema.parse({
              schemaVersion: 2,
              scope: reviewed.scope,
              oldSubtitleId: old.id,
              candidateSubtitleId: candidate.id,
              expectedOldVersion: old.version,
              expectedCandidateVersion: candidate.version,
            }),
          });
        }}
      >
        <SelectField
          label="Validated candidate"
          description="Only validated, accepted captions of the same language and kind are offered."
          name="candidate"
          required
          requiredMessage="Choose the validated caption that replaces this one."
          disabled={command.blocked}
          value={candidateId}
          onChange={(event) => {
            setCandidateId(event.target.value);
          }}
        >
          <option value="">Choose validated bytes…</option>
          {candidates.subtitles
            .filter(
              (caption) =>
                caption.state === "validated" &&
                caption.qualityStatus === "accepted" &&
                caption.language === old.language &&
                caption.forced === old.forced &&
                caption.hearingImpaired === old.hearingImpaired,
            )
            .map((caption) => (
              <option key={caption.id} value={caption.id}>
                {caption.language}: {caption.providerId},{" "}
                {caption.id.slice(0, 8)}
              </option>
            ))}
        </SelectField>
        <FormFooter
          submitLabel="Prepare replacement review"
          pendingLabel="Preparing…"
          pending={command.isPending}
          disabled={command.blocked}
          note="Preparing checks the files and replaces nothing."
        />
      </Form>
      <CommandFailure
        error={command.error}
        what="The preparation"
        unknown={command.unknown}
        pending={command.isPending}
        onReview={() => {
          command.reset();
          refresh();
        }}
        onRetry={command.retryOriginal}
      />
    </>
  );
}
