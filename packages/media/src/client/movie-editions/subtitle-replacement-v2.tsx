import { useState } from "react";
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
import { ErrorNotice, Loading, Notice } from "#client/components.tsx";
import { CommandError } from "#client/target-controls/errors.tsx";
import { MovieCaptionUploadV2 } from "./subtitle-upload-v2.tsx";
import { useMovieCaptionCommandV2 } from "./subtitle-api-v2.ts";

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
      <Notice>
        Review prepared for {movieEditionDisplayLabel(prepared.scope.edition)}.{" "}
        <Link to={`/admin/subtitle-replacements/${prepared.id}`}>
          Inspect and approve the exact replacement
        </Link>
      </Notice>
    );
  return (
    <details
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>Replace captions for {context.editionLabel}</summary>
      {target.isPending && <Loading />}
      {target.error !== null && <ErrorNotice error={target.error} />}
      {target.data !== undefined && (
        <label>
          Installed sidecar
          <select
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
                  {caption.language} · {caption.filename}
                </option>
              ))}
          </select>
        </label>
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
    </details>
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
  const [candidateId, setCandidateId] = useState("");
  const command = useMovieCaptionCommandV2(user.id, { onPrepared });
  const old = reviewed.subtitles.find((caption) => caption.id === oldId);
  if (old === undefined)
    throw new Error("Reviewed caption left its exact video context");
  const candidate = candidates.subtitles.find(
    (caption) => caption.id === candidateId,
  );
  return (
    <div className="stack-form">
      <label>
        Validated candidate
        <select
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
                {caption.language} · {caption.providerId} ·{" "}
                {caption.id.slice(0, 8)}
              </option>
            ))}
        </select>
      </label>
      <button
        className="button"
        disabled={command.blocked || candidate === undefined}
        onClick={() => {
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
        Prepare replacement review
      </button>
      <CommandError
        error={command.error}
        review={() => {
          command.reset();
          refresh();
        }}
      />
      {command.unknown && (
        <button
          className="button"
          disabled={command.isPending}
          onClick={command.retryOriginal}
        >
          Retry original preparation
        </button>
      )}
    </div>
  );
}
