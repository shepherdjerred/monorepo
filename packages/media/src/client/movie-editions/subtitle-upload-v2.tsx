import { useState } from "react";
import type { MediaUser } from "#shared/contract.ts";
import type { MovieSubtitleTargetV2 } from "#shared/movie-editions/subtitle-target-v2.ts";
import { MovieManualReplacementV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { readSubtitleUpload } from "#client/subtitle-upload.ts";
import { sessionBoundary } from "#client/api.ts";
import { ErrorNotice, Notice } from "#client/components.tsx";
import { CommandError } from "#client/target-controls/errors.tsx";
import { useMovieCaptionCommandV2 } from "./subtitle-api-v2.ts";

type Caption = MovieSubtitleTargetV2["subtitles"][number];

export function MovieCaptionUploadV2({
  user,
  context,
  old,
  refresh,
}: {
  user: MediaUser;
  context: MovieSubtitleTargetV2;
  old: Caption;
  refresh: () => void;
}) {
  const command = useMovieCaptionCommandV2(user.id);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function upload(form: FormData) {
    const session = sessionBoundary.capture(user.id);
    setError(null);
    setReading(true);
    try {
      const parsed = await readSubtitleUpload(form, context);
      session.assertCurrent();
      const body = MovieManualReplacementV2Schema.parse({
        ...parsed,
        schemaVersion: 2,
        scope: context.scope,
      });
      command.submit({
        path: `/media/${context.scope.mediaId}/movie-editions/${context.scope.edition}/subtitle-replacements/candidates`,
        body,
      });
    } catch (error_) {
      if (!(error_ instanceof Error)) throw error_;
      setError(error_);
    } finally {
      setReading(false);
    }
  }
  return (
    <>
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          void upload(new FormData(event.currentTarget));
        }}
      >
        <fieldset disabled={reading || command.blocked}>
          <legend>Upload a replacement for {old.filename}</legend>
          <p>
            {context.editionLabel} · {old.language}
            {old.forced === true ? " · Forced dialogue" : ""}
          </p>
          <input type="hidden" name="replacementFor" value={old.id} />
          <input type="hidden" name="language" value={old.language} />
          <input
            type="hidden"
            name="hearingImpaired"
            value={
              old.hearingImpaired === null
                ? "unknown"
                : old.hearingImpaired
                  ? "yes"
                  : "no"
            }
          />
          {old.forced === true && (
            <input type="hidden" name="forced" value="on" />
          )}
          <label>
            Subtitle file
            <input
              type="file"
              name="subtitle"
              accept=".srt,.ass,.ssa,.vtt"
              required
            />
          </label>
          <label>
            Text encoding
            <select name="encoding" defaultValue="bom">
              <option value="bom">Detect from file signature</option>
              <option value="utf8">UTF-8</option>
              <option value="utf-16le">UTF-16 LE</option>
              <option value="utf-16be">UTF-16 BE</option>
              <option value="gb18030">GB18030</option>
            </select>
          </label>
          <label>
            Source and quality notes
            <textarea name="description" required maxLength={2000} />
          </label>
          <label className="check-label">
            <input name="confirmed" type="checkbox" required />I checked this
            file against this exact edition and video version.
          </label>
          <button className="button" disabled={reading || command.blocked}>
            {reading ? "Reading file…" : "Upload replacement candidate"}
          </button>
        </fieldset>
      </form>
      {error !== null && <ErrorNotice error={error} />}
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
          Retry original caption upload
        </button>
      )}
      {command.isSuccess && (
        <Notice>
          Candidate uploaded. Choose it below to prepare an exact replacement
          review.
        </Notice>
      )}
    </>
  );
}
