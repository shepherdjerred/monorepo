import { useId } from "react";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import type { MigrationProposalListSchema } from "#shared/migration.ts";
import {
  LibraryCaptureKindSchema,
  CreateLibraryBundleV2Schema,
  BundleReviewProtocolSchema,
} from "#shared/handoff/library-bundle.ts";
import { writeApi, queryClient } from "#client/api.ts";
import { SOURCE_LABELS, when } from "#client/migration/vocabulary.ts";
import { FieldGroup, SelectField, TextField } from "#client/ui/forms/field.tsx";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";

type Captures = z.infer<typeof MigrationProposalListSchema>;
type Kind = z.infer<typeof LibraryCaptureKindSchema>;

const FIELDS = {
  radarr: { label: "Movies, from Radarr", skip: "Choose a capture" },
  sonarr: { label: "TV and anime, from Sonarr", skip: "Choose a capture" },
  bazarr: {
    label: "Subtitles, from Bazarr (optional)",
    skip: "Skip subtitle capture",
  },
} satisfies Record<Kind, { label: string; skip: string }>;

/** A root as the capture contract accepts it: absolute, without `..`, `?` or `#`. */
const ROOT = String.raw`/(?!.*(?:\.\.|[?#])).*`;
const ROOT_MESSAGE =
  "Enter an absolute path such as /data/movies, without “..”, “?” or “#”.";

function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Step 3's form: which captures to compare and where each library lives, as
 * the source manager sees it and as Media sees it. Building the report
 * changes nothing; files stay in place.
 */
export function LibraryBundleForm({
  captures,
  actorId,
  onCreated,
}: {
  captures: Captures;
  actorId: string;
  onCreated: (id: string) => void;
}) {
  const headingId = useId();
  const create = useMutation({
    mutationFn: (data: FormData) => {
      const selected: Record<Kind, string> = {
        radarr: text(data, "radarr"),
        sonarr: text(data, "sonarr"),
        bazarr: text(data, "bazarr"),
      };
      return writeApi({
        actorId,
        path: "/admin/migration/bundles",
        schema: BundleReviewProtocolSchema,
        body: CreateLibraryBundleV2Schema.parse({
          schemaVersion: 2,
          purpose: "initial_library",
          captureIds: Object.values(selected).filter((id) => id !== ""),
          rootMappings: [
            {
              captureId: selected.radarr,
              sourceRoot: text(data, "movieSource"),
              canonicalRoot: text(data, "movieLocation"),
              verified: false,
            },
            {
              captureId: selected.sonarr,
              sourceRoot: text(data, "tvSource"),
              canonicalRoot: text(data, "tvLocation"),
              verified: false,
            },
          ],
        }),
      });
    },
    onSuccess: async (review) => {
      onCreated(review.id);
      await queryClient.invalidateQueries({
        queryKey: ["migration", "bundles"],
      });
    },
  });
  const distinct = [
    ...new Map(
      captures.map((capture) => [capture.captureId, capture]),
    ).values(),
  ];
  return (
    <>
      <h3 id={headingId}>Compare your captures</h3>
      <Form
        labelledBy={headingId}
        onSubmit={(form) => {
          create.mutate(new FormData(form));
        }}
      >
        {LibraryCaptureKindSchema.options.map((kind) => {
          const matching = distinct.filter(
            (capture) => capture.source.kind === kind,
          );
          return (
            <SelectField
              key={kind}
              label={FIELDS[kind].label}
              name={kind}
              required={kind !== "bazarr"}
              requiredMessage={`Choose a ${SOURCE_LABELS[kind]} capture.`}
              disabled={create.isPending}
              description={
                matching.length === 0
                  ? `There is no ${SOURCE_LABELS[kind]} capture yet. Add one in step 1.`
                  : undefined
              }
              defaultValue=""
            >
              <option value="">{FIELDS[kind].skip}</option>
              {matching.map((capture) => (
                <option key={capture.captureId} value={capture.captureId}>
                  {when(capture.createdAt)}, version {capture.source.version}
                </option>
              ))}
            </SelectField>
          );
        })}
        <FieldGroup
          legend="Library locations"
          description="Use the roots your existing managers show and the locations Media can see. Files stay in place."
        >
          <TextField
            label="Movie root in Radarr"
            name="movieSource"
            placeholder="/movies"
            required
            requiredMessage="Enter the movie root as Radarr shows it."
            pattern={ROOT}
            patternMessage={ROOT_MESSAGE}
            disabled={create.isPending}
          />
          <TextField
            label="Movie location in Media"
            name="movieLocation"
            defaultValue="/data/movies"
            required
            requiredMessage="Enter where Media sees the movies."
            pattern={ROOT}
            patternMessage={ROOT_MESSAGE}
            disabled={create.isPending}
          />
          <TextField
            label="TV root in Sonarr"
            name="tvSource"
            placeholder="/tv"
            required
            requiredMessage="Enter the TV root as Sonarr shows it."
            pattern={ROOT}
            patternMessage={ROOT_MESSAGE}
            disabled={create.isPending}
          />
          <TextField
            label="TV location in Media"
            name="tvLocation"
            defaultValue="/data/tv"
            required
            requiredMessage="Enter where Media sees the TV library."
            pattern={ROOT}
            patternMessage={ROOT_MESSAGE}
            disabled={create.isPending}
          />
        </FieldGroup>
        <FormFooter
          submitLabel="Build library report"
          pendingLabel="Comparing your library…"
          pending={create.isPending}
          error={create.error}
          saved={
            create.isSuccess ? "Library report built. Review it below." : null
          }
          note="Building a report compares the captures and saves the result. It changes no files."
        />
      </Form>
    </>
  );
}
