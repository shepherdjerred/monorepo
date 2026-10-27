import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { CommandResultSchema, ProfileListSchema } from "#shared/api.ts";
import { readApi, writeApi } from "#client/api.ts";
import { ErrorNotice } from "#client/components.tsx";
import {
  libraryBatchEntries,
  libraryProfileGroups,
  type LibraryReview,
} from "./selection.ts";
import { prepareLibraryBatch, type BatchChoices } from "./prepare.ts";
import { CutField, ProfileFields } from "./batch-fields.tsx";

export function LibraryBatch({
  review,
  actorId,
}: {
  review: LibraryReview;
  actorId: string;
}) {
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
  return (
    <section>
      <h3>Prepare files for adoption</h3>
      <p>
        Select up to 25 files. Media will check their current bytes and Plex
        identity, then show the exact changes for approval.
      </p>
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          prepare.mutate();
        }}
      >
        <fieldset disabled={prepare.isPending}>
          <legend>Files · {choices.files.length} selected</legend>
          {files.slice(page * 25, (page + 1) * 25).map((entry) => (
            <label className="checkbox-row" key={entry.provenanceKey}>
              <input
                type="checkbox"
                checked={choices.files.includes(entry.provenanceKey)}
                disabled={
                  entry.confidence !== "exact" ||
                  (!choices.files.includes(entry.provenanceKey) &&
                    choices.files.length >= 25)
                }
                onChange={(event) => {
                  setChoices({
                    ...choices,
                    files: event.target.checked
                      ? [...choices.files, entry.provenanceKey]
                      : choices.files.filter(
                          (key) => key !== entry.provenanceKey,
                        ),
                  });
                }}
              />
              <span>
                {entry.mappedMedia
                  .map((item) => item.title ?? item.mediaId)
                  .join(", ")}
                <br />
                <code>
                  {entry.sourceRecord.kind === "file"
                    ? entry.sourceRecord.path
                    : entry.sourceId}
                </code>
              </span>
            </label>
          ))}
          <div className="action-row">
            <button
              className="button"
              type="button"
              disabled={page === 0}
              onClick={() => {
                setPage(page - 1);
              }}
            >
              Previous files
            </button>
            <button
              className="button"
              type="button"
              disabled={(page + 1) * 25 >= files.length}
              onClick={() => {
                setPage(page + 1);
              }}
            >
              Next files
            </button>
          </div>
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
                <fieldset key={entry.provenanceKey}>
                  <legend>
                    {entry.mappedMedia
                      .map((item) => item.title ?? item.mediaId)
                      .join(", ")}
                  </legend>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
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
                    Monitor this series, including future episodes
                  </label>
                  <p>
                    Media will use the selected quality profile for newly
                    discovered episodes and preserve existing episode overrides.
                    This creates household monitoring, not personal requests.
                  </p>
                  {policy?.enabled === true && (
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
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
                      Include specials
                    </label>
                  )}
                  {!eligible && (
                    <p>
                      The captured series must have an exact mapping before it
                      can supply this policy.
                    </p>
                  )}
                </fieldset>
              );
            })}
          <p>
            {batch.entries.filter((entry) => entry.kind === "subtitle").length}{" "}
            exactly associated captions will be checked with these files.
          </p>
          {batch.entries
            .filter((entry) => entry.kind === "subtitle_preference")
            .map((entry) => (
              <label className="checkbox-row" key={entry.provenanceKey}>
                <input
                  type="checkbox"
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
                Require Simplified Chinese for{" "}
                {entry.mappedMedia
                  .map((item) => item.title ?? item.mediaId)
                  .join(", ")}
                . Generic Chinese stays unresolved unless selected.
              </label>
            ))}
        </fieldset>
        <p>
          Plex edition labels will be corrected in place after you approve the
          prepared plan. File paths and personal requests are preserved.
        </p>
        <button
          className="button primary"
          disabled={
            choices.files.length === 0 ||
            profiles.isPending ||
            profiles.error !== null ||
            prepare.isPending
          }
          type="submit"
        >
          {prepare.isPending
            ? "Preparing review…"
            : "Check files and prepare review"}
        </button>
        {profiles.error !== null && <ErrorNotice error={profiles.error} />}
        {prepare.error !== null && <ErrorNotice error={prepare.error} />}
      </form>
    </section>
  );
}
