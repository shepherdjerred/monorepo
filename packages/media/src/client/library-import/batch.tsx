import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { CommandResultSchema, ProfileListSchema } from "#shared/api.ts";
import { readApi, writeApi } from "#client/api.ts";
import { LoadError } from "#client/ui/feedback.tsx";
import { CheckboxField, FieldGroup } from "#client/ui/forms/field.tsx";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";
import { Code, Pager, PickBox, PickList } from "#client/ui/workflow.tsx";
import {
  libraryBatchEntries,
  libraryProfileGroups,
  type LibraryReview,
} from "./selection.ts";
import { prepareLibraryBatch, type BatchChoices } from "./prepare.ts";
import { CutField, ProfileFields } from "./batch-fields.tsx";

const FILES_PER_PAGE = 25;

function titlesOf(entry: {
  mappedMedia: readonly { mediaId: string; title: string | null }[];
}): string {
  return entry.mappedMedia.map((item) => item.title ?? item.mediaId).join(", ");
}

/**
 * Step 4: choose up to 25 files of an approved report and say how each is
 * classified. Preparing asks Media to check the files' current bytes and
 * Plex identity and to write the exact changes down for step 5. Nothing is
 * adopted by it.
 */
export function LibraryBatch({
  review,
  actorId,
}: {
  review: LibraryReview;
  actorId: string;
}) {
  const headingId = useId();
  const [page, setPage] = useState(0);
  const [choices, setChoices] = useState<BatchChoices>({
    files: [],
    cuts: {},
    profiles: {},
    chinese: {},
    seriesMonitoring: {},
  });
  const [, setSearchParams] = useSearchParams();
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => readApi("/profiles", ProfileListSchema),
  });
  const batch = libraryBatchEntries(review, choices.files);
  const groups = libraryProfileGroups(review, batch.media, profiles.data ?? []);
  const prepare = useMutation({
    mutationFn: async () => {
      const body = await prepareLibraryBatch(review, choices, groups);
      return writeApi({
        actorId,
        path: "/admin/handoffs",
        body,
        schema: CommandResultSchema,
      });
    },
    onSuccess: (result) => {
      const id = result.handoffId;
      if (id === undefined)
        throw new Error("The import response is missing its plan");
      setSearchParams((previous) => {
        previous.set("handoff", id);
        return previous;
      });
    },
  });
  const files = review.report.entries.filter((entry) => entry.kind === "file");
  const movieCaptures = new Set(
    review.manifest.captures
      .filter((capture) => capture.sourceKind === "radarr")
      .map((capture) => capture.captureHash),
  );
  const captions = batch.entries.filter(
    (entry) => entry.kind === "subtitle",
  ).length;
  return (
    <>
      <h3 className="sr-only" id={headingId}>
        Files to prepare
      </h3>
      <Form
        labelledBy={headingId}
        validate={() => ({
          ...(choices.files.length === 0
            ? { files: "Select at least one file." }
            : {}),
          ...(choices.files.length > 0 && profiles.data === undefined
            ? {
                files:
                  "Quality profiles have not loaded yet. Try again in a moment.",
              }
            : {}),
        })}
        onSubmit={() => {
          prepare.mutate();
        }}
      >
        <FieldGroup
          legend={`Files: ${String(choices.files.length)} of ${String(FILES_PER_PAGE)} selected`}
          description="Select up to 25 files. Only files with an exact match can be selected."
        >
          <PickList data-field="files" data-field-label="Files" tabIndex={-1}>
            {files
              .slice(page * FILES_PER_PAGE, (page + 1) * FILES_PER_PAGE)
              .map((entry) => (
                <PickBox
                  key={entry.provenanceKey}
                  checked={choices.files.includes(entry.provenanceKey)}
                  disabled={
                    prepare.isPending ||
                    entry.confidence !== "exact" ||
                    (!choices.files.includes(entry.provenanceKey) &&
                      choices.files.length >= FILES_PER_PAGE)
                  }
                  onChange={(checked) => {
                    setChoices({
                      ...choices,
                      files: checked
                        ? [...choices.files, entry.provenanceKey]
                        : choices.files.filter(
                            (key) => key !== entry.provenanceKey,
                          ),
                    });
                  }}
                >
                  {titlesOf(entry)}
                  <br />
                  <Code>
                    {entry.sourceRecord.kind === "file"
                      ? entry.sourceRecord.path
                      : entry.sourceId}
                  </Code>
                </PickBox>
              ))}
          </PickList>
          {files.length > FILES_PER_PAGE && (
            <Pager
              what="files"
              from={page * FILES_PER_PAGE + 1}
              to={Math.min((page + 1) * FILES_PER_PAGE, files.length)}
              total={files.length}
              onPrevious={
                page === 0
                  ? null
                  : () => {
                      setPage(page - 1);
                    }
              }
              onNext={
                (page + 1) * FILES_PER_PAGE >= files.length
                  ? null
                  : () => {
                      setPage(page + 1);
                    }
              }
            />
          )}
        </FieldGroup>
        {batch.entries
          .filter(
            (entry) =>
              entry.kind === "file" && movieCaptures.has(entry.captureHash),
          )
          .map((entry) => (
            <CutField
              key={entry.provenanceKey}
              entry={entry}
              choice={
                choices.cuts[entry.provenanceKey] ?? {
                  edition: "suggest",
                  reason: "",
                }
              }
              onChange={(choice) => {
                setChoices({
                  ...choices,
                  cuts: { ...choices.cuts, [entry.provenanceKey]: choice },
                });
              }}
            />
          ))}
        <ProfileFields
          groups={groups}
          choices={choices.profiles}
          onChange={(key, value) => {
            setChoices({
              ...choices,
              profiles: { ...choices.profiles, [key]: value },
            });
          }}
        />
        {batch.media
          .filter(
            (entry) =>
              entry.sourceRecord.kind === "media" &&
              entry.sourceRecord.mediaKind === "series",
          )
          .map((entry) => {
            const policy = choices.seriesMonitoring?.[entry.provenanceKey];
            const eligible =
              entry.confidence === "exact" &&
              entry.sourceRecord.kind === "media" &&
              entry.mediaIds.length === 1;
            return (
              <FieldGroup key={entry.provenanceKey} legend={titlesOf(entry)}>
                <CheckboxField
                  label="Monitor this series, including future episodes"
                  description="Media will use the selected quality profile for newly discovered episodes and keep existing episode overrides. This creates household monitoring, not personal requests."
                  disabled={!eligible}
                  checked={policy?.enabled === true}
                  onChange={(event) => {
                    setChoices({
                      ...choices,
                      seriesMonitoring: {
                        ...choices.seriesMonitoring,
                        [entry.provenanceKey]: {
                          enabled: event.target.checked,
                          includeSpecials: policy?.includeSpecials === true,
                        },
                      },
                    });
                  }}
                />
                {policy?.enabled === true && (
                  <CheckboxField
                    label="Include specials"
                    checked={policy.includeSpecials}
                    onChange={(event) => {
                      setChoices({
                        ...choices,
                        seriesMonitoring: {
                          ...choices.seriesMonitoring,
                          [entry.provenanceKey]: {
                            enabled: true,
                            includeSpecials: event.target.checked,
                          },
                        },
                      });
                    }}
                  />
                )}
                {!eligible && (
                  <p>
                    The captured series must have an exact mapping before it can
                    supply this policy.
                  </p>
                )}
              </FieldGroup>
            );
          })}
        <p>
          {captions} exactly associated caption{captions === 1 ? "" : "s"} will
          be checked with these files.
        </p>
        {batch.entries
          .filter((entry) => entry.kind === "subtitle_preference")
          .map((entry) => (
            <CheckboxField
              key={entry.provenanceKey}
              label={`Require Simplified Chinese for ${titlesOf(entry)}`}
              description="Generic Chinese stays unresolved unless you select this."
              checked={choices.chinese[entry.provenanceKey] === true}
              onChange={(event) => {
                setChoices({
                  ...choices,
                  chinese: {
                    ...choices.chinese,
                    [entry.provenanceKey]: event.target.checked,
                  },
                });
              }}
            />
          ))}
        {profiles.error !== null && (
          <LoadError
            what="Quality profiles"
            error={profiles.error}
            retry={() => {
              void profiles.refetch();
            }}
          />
        )}
        <FormFooter
          submitLabel="Check files and prepare review"
          pendingLabel="Preparing review…"
          pending={prepare.isPending}
          error={prepare.error}
          saved={
            prepare.isSuccess ? "Review prepared. It is open in step 5." : null
          }
          note="Media checks the selected files and their Plex identity, then shows the exact changes for you to approve in step 5. Nothing is adopted yet. Plex edition labels are corrected in place only after that approval; file paths and personal requests are preserved."
        />
      </Form>
    </>
  );
}
