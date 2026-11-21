import { useId, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { SearchIcon } from "lucide-react";
import { CommandResultSchema, type CommandResult } from "#shared/api.ts";
import {
  MAX_MANUAL_SUBTITLE_BYTES,
  SubtitleTargetListSchema,
  type ManualSubtitle,
  type SubtitleTarget,
} from "#shared/admin.ts";
import { ApiError, queryClient, readApi, writeApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { useUser } from "#client/shell/user.ts";
import { submitSubtitleUpload } from "#client/subtitle-upload.ts";
import { Button, ButtonLink } from "#client/ui/button.tsx";
import { LoadError } from "#client/ui/feedback.tsx";
import {
  CheckboxField,
  ChoiceField,
  SelectField,
  TextAreaField,
  TextField,
} from "#client/ui/field.tsx";
import { FieldRow, Form, FormFooter } from "#client/ui/form.tsx";
import { EmptyNote, Section, SkeletonRows } from "#client/ui/section.tsx";

const SUBTITLE_FILE = /\.(?:srt|ass|ssa|vtt)$/iu;

/** Problems with the chosen file that the file input itself cannot state. */
function fileProblems(form: HTMLFormElement): Record<string, string> {
  const file = new FormData(form).get("subtitle");
  if (!(file instanceof File) || file.name === "") return {};
  if (!SUBTITLE_FILE.test(file.name)) {
    return { subtitle: "Choose an SRT, ASS, SSA, or WebVTT file." };
  }
  if (file.size === 0) return { subtitle: "This file is empty." };
  return file.size > MAX_MANUAL_SUBTITLE_BYTES
    ? { subtitle: "Choose a file no larger than 8 MiB." }
    : {};
}

/** What happened to a file the server accepted. */
function Accepted({ result }: { result: CommandResult }) {
  return result.subtitleId === undefined ? (
    "Subtitle checked and queued to be installed."
  ) : (
    <span>
      Subtitle checked and held; nothing has changed yet.{" "}
      <Link to="/manage/subtitles/replacements">
        Prepare its replacement review
      </Link>
      .
    </span>
  );
}

function UploadForm({
  targets,
  headingId,
}: {
  targets: SubtitleTarget[];
  headingId: string;
}) {
  const user = useUser();
  const [assetId, setAssetId] = useState("");
  const [unsent, setUnsent] = useState<Error | null>(null);
  const target = targets.find((item) => item.assetId === assetId);
  const replaceable =
    target?.subtitles.filter(
      (subtitle) =>
        subtitle.state === "installed" && subtitle.storageKind === "sidecar",
    ) ?? [];
  const upload = useMutation({
    mutationFn: async (input: ManualSubtitle) =>
      writeApi({
        actorId: user.id,
        path: "/admin/subtitles",
        body: input,
        schema: CommandResultSchema,
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["subtitle-targets"] }),
  });
  async function submit(form: HTMLFormElement) {
    setUnsent(null);
    try {
      if (target === undefined) throw new Error("No video is selected");
      await submitSubtitleUpload(
        { actorId: user.id, form: new FormData(form), target },
        upload.mutateAsync,
      );
      form.reset();
      setAssetId("");
    } catch (error) {
      // The server's own refusal is shown as it was worded.
      if (error instanceof ApiError) return;
      setUnsent(
        new Error(
          "The file was not sent. Check the video, the file, and the confirmation.",
        ),
      );
    }
  }
  return (
    <Form
      labelledBy={headingId}
      validate={fileProblems}
      onSubmit={(form) => {
        void submit(form);
      }}
    >
      <SelectField
        label="Video file"
        description="Choose the exact file. A title can have more than one."
        name="assetId"
        required
        requiredMessage="Choose the video this subtitle is for."
        value={assetId}
        onChange={(event) => {
          setAssetId(event.target.value);
        }}
      >
        <option value="" disabled>
          Choose a video
        </option>
        {targets.map((item) => (
          <option key={item.assetId} value={item.assetId}>
            {item.titles.join(" / ")}: {item.filename} (version {item.version})
          </option>
        ))}
      </SelectField>
      <SelectField
        // The choices belong to the video, so they start again with it.
        key={assetId}
        label="Replace a subtitle this video already has"
        description={
          target === undefined
            ? "Choose a video to see its installed subtitles."
            : "Replacing never happens straight away: the file is checked and held for your review."
        }
        optional
        name="replacementFor"
        defaultValue=""
      >
        <option value="">No, add it as a new subtitle</option>
        {replaceable.map((subtitle) => (
          <option key={subtitle.id} value={subtitle.id}>
            {subtitle.filename}
          </option>
        ))}
      </SelectField>
      <ChoiceField
        legend="Language"
        name="language"
        defaultValue="en"
        options={[
          { value: "en", label: "English" },
          { value: "zh-Hans", label: "Simplified Chinese" },
        ]}
      />
      <CheckboxField
        label="Forced subtitles"
        description="Only the lines that are not in the main spoken language."
        name="forced"
      />
      <ChoiceField
        legend="Captions for the deaf and hard of hearing"
        description="If you are not sure, this file cannot satisfy a request that asks for these captions or asks to leave them out."
        name="hearingImpaired"
        defaultValue="unknown"
        options={[
          { value: "unknown", label: "Not sure" },
          { value: "no", label: "Not included" },
          { value: "yes", label: "Included" },
        ]}
      />
      <TextField
        label="Subtitle file"
        description="SRT, ASS, SSA, or WebVTT, up to 8 MiB."
        name="subtitle"
        type="file"
        accept=".srt,.ass,.ssa,.vtt"
        required
        requiredMessage="Choose the subtitle file."
      />
      <SelectField label="Text encoding" name="encoding">
        <option value="bom">UTF-8, or Unicode with a BOM</option>
        <option value="gb18030">GB18030, confirmed by the source</option>
        <option value="utf-16le">UTF-16, little endian</option>
        <option value="utf-16be">UTF-16, big endian</option>
      </SelectField>
      <TextAreaField
        label="Where it comes from and how it matches"
        description="The translator or source, and the release this subtitle was timed for."
        name="description"
        rows={3}
        maxLength={2000}
        required
        requiredMessage="Say where this subtitle comes from."
      />
      <CheckboxField
        label="I checked that this subtitle matches the chosen video file and episode"
        name="confirmed"
        required
        requiredMessage="Confirm the match before sending the file."
      />
      <FormFooter
        submitLabel="Check and add subtitle"
        pendingLabel="Sending…"
        pending={upload.isPending}
        error={unsent ?? upload.error}
        saved={upload.isSuccess ? <Accepted result={upload.data} /> : null}
      />
    </Form>
  );
}

export function SubtitlesPage() {
  const [search, setSearch] = useState("");
  const headingId = useId();
  const targets = useQuery({
    queryKey: ["subtitle-targets", search],
    queryFn: async () =>
      readApi(
        `/admin/subtitles/targets?q=${encodeURIComponent(search)}`,
        SubtitleTargetListSchema,
      ),
  });
  function find(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("query");
    if (typeof query !== "string") throw new TypeError("Missing query");
    setSearch(query);
  }
  return (
    <>
      <PageTitle title="Subtitles">
        <p>Add a subtitle file to a video, or replace one that is installed.</p>
      </PageTitle>
      <Section
        title="Add a subtitle file"
        description="Media checks the file before anything changes. If the video already has a subtitle in the same language and of the same kind, the new file has to go through a replacement review."
      >
        <search>
          <form onSubmit={find}>
            <FieldRow>
              <TextField
                label="Find a video"
                description="Search your library by title."
                name="query"
                type="search"
                maxLength={200}
                autoComplete="off"
              />
              <Button type="submit">
                <SearchIcon aria-hidden="true" />
                Search
              </Button>
            </FieldRow>
          </form>
        </search>
        <h3 className="sr-only" id={headingId}>
          Subtitle details
        </h3>
        {targets.isPending && (
          <SkeletonRows label="Loading videos" rows={4} tall />
        )}
        {targets.error !== null && (
          <LoadError
            what="Videos"
            error={targets.error}
            retry={() => {
              void targets.refetch();
            }}
          />
        )}
        {targets.data?.length === 0 && (
          <EmptyNote>
            {search === ""
              ? "Your library has no videos a subtitle can be added to yet."
              : `No video matches “${search}”. Try part of the title.`}
          </EmptyNote>
        )}
        {targets.data !== undefined && targets.data.length > 0 && (
          <UploadForm targets={targets.data} headingId={headingId} />
        )}
      </Section>
      <Section
        title="Replacement reviews"
        description="Subtitles held as replacements wait here. Each one is compared with the subtitle it would replace before anything is swapped."
      >
        <div>
          <ButtonLink to="/manage/subtitles/replacements">
            Review subtitle replacements
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
