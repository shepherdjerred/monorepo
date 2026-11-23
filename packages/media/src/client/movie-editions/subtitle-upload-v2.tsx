import { useId, useState } from "react";
import type { MediaUser } from "#shared/contract.ts";
import type { MovieSubtitleTargetV2 } from "#shared/movie-editions/subtitle-target-v2.ts";
import { MovieManualReplacementV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { readSubtitleUpload } from "#client/subtitle-upload.ts";
import { sessionBoundary } from "#client/api.ts";
import { CommandFailure } from "#client/subtitle-replacement/failure.tsx";
import {
  CheckboxField,
  SelectField,
  TextAreaField,
  TextField,
} from "#client/ui/forms/field.tsx";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";
import { useMovieCaptionCommandV2 } from "./subtitle-api-v2.ts";

type Caption = MovieSubtitleTargetV2["subtitles"][number];

/** Uploads a candidate that can replace one installed caption of one edition. */
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
  const headingId = useId();
  const command = useMovieCaptionCommandV2(user.id);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const busy = reading || command.blocked;
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
      <h4 id={headingId}>Upload a replacement for {old.filename}</h4>
      <p>
        {context.editionLabel}, {old.language}
        {old.forced === true ? ", forced dialogue only" : ""}. The file is
        checked and held as a candidate. Nothing is replaced until you approve a
        prepared review.
      </p>
      <Form
        labelledBy={headingId}
        onSubmit={(form) => {
          void upload(new FormData(form));
        }}
      >
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
        <TextField
          label="Subtitle file"
          description="SRT, ASS, SSA, or WebVTT."
          name="subtitle"
          type="file"
          accept=".srt,.ass,.ssa,.vtt"
          required
          requiredMessage="Choose the subtitle file."
          disabled={busy}
        />
        <SelectField
          label="Text encoding"
          name="encoding"
          defaultValue="bom"
          disabled={busy}
        >
          <option value="bom">Detect from file signature</option>
          <option value="utf8">UTF-8</option>
          <option value="utf-16le">UTF-16 LE</option>
          <option value="utf-16be">UTF-16 BE</option>
          <option value="gb18030">GB18030</option>
        </SelectField>
        <TextAreaField
          label="Source and quality notes"
          description="Where the file comes from and how it was timed."
          name="description"
          rows={3}
          required
          requiredMessage="Say where this subtitle comes from."
          maxLength={2000}
          disabled={busy}
        />
        <CheckboxField
          label="I checked this file against this exact edition and video version."
          name="confirmed"
          required
          requiredMessage="Confirm the match before sending the file."
          disabled={busy}
        />
        <FormFooter
          submitLabel="Upload replacement candidate"
          pendingLabel={reading ? "Reading file…" : "Uploading…"}
          pending={reading || command.isPending}
          disabled={command.blocked}
          error={error}
          saved={
            command.isSuccess
              ? "Candidate uploaded. Choose it below to prepare an exact replacement review."
              : null
          }
        />
      </Form>
      <CommandFailure
        error={command.error}
        what="The upload"
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
