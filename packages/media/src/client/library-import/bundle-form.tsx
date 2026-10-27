import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import type { MigrationProposalListSchema } from "#shared/migration.ts";
import {
  LibraryCaptureKindSchema,
  CreateLibraryBundleV2Schema,
  BundleReviewProtocolSchema,
} from "#shared/handoff/library-bundle.ts";
import { writeApi, queryClient } from "#client/api.ts";
import { ErrorNotice } from "#client/components.tsx";

type Captures = z.infer<typeof MigrationProposalListSchema>;
type Kind = z.infer<typeof LibraryCaptureKindSchema>;
const labels = {
  radarr: "Movies · Radarr",
  sonarr: "TV and anime · Sonarr",
  bazarr: "Subtitles · Bazarr (optional)",
};

export function LibraryBundleForm({
  captures,
  actorId,
  onCreated,
}: {
  captures: Captures;
  actorId: string;
  onCreated: (id: string) => void;
}) {
  const [selected, setSelected] = useState<Record<Kind, string>>({
    radarr: "",
    sonarr: "",
    bazarr: "",
  });
  const [movieSource, setMovieSource] = useState("");
  const [tvSource, setTvSource] = useState("");
  const [movieLocation, setMovieLocation] = useState("/data/movies");
  const [tvLocation, setTvLocation] = useState("/data/tv");
  const create = useMutation({
    mutationFn: () =>
      writeApi({
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
              sourceRoot: movieSource,
              canonicalRoot: movieLocation,
              verified: false,
            },
            {
              captureId: selected.sonarr,
              sourceRoot: tvSource,
              canonicalRoot: tvLocation,
              verified: false,
            },
          ],
        }),
      }),
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
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <p>
        Choose your movie and TV library captures. Add a subtitle capture to
        review existing captions and policies.
      </p>
      {LibraryCaptureKindSchema.options.map((kind) => (
        <label key={kind}>
          {labels[kind]}
          <select
            value={selected[kind]}
            required={kind !== "bazarr"}
            disabled={create.isPending}
            onChange={(event) => {
              setSelected({ ...selected, [kind]: event.target.value });
            }}
          >
            <option value="">
              {kind === "bazarr" ? "Skip subtitle capture" : "Choose a capture"}
            </option>
            {distinct
              .filter((capture) => capture.source.kind === kind)
              .map((capture) => (
                <option key={capture.captureId} value={capture.captureId}>
                  {new Date(capture.createdAt).toLocaleString()} ·{" "}
                  {capture.source.version}
                </option>
              ))}
          </select>
        </label>
      ))}
      <fieldset disabled={create.isPending}>
        <legend>Library locations</legend>
        <p>
          Use the roots shown by your existing managers and the locations
          visible to Media. Files stay in place.
        </p>
        <label>
          Movie root in Radarr
          <input
            value={movieSource}
            required
            placeholder="/movies"
            onChange={(event) => {
              setMovieSource(event.target.value);
            }}
          />
        </label>
        <label>
          Movie location in Media
          <input
            value={movieLocation}
            required
            onChange={(event) => {
              setMovieLocation(event.target.value);
            }}
          />
        </label>
        <label>
          TV root in Sonarr
          <input
            value={tvSource}
            required
            placeholder="/tv"
            onChange={(event) => {
              setTvSource(event.target.value);
            }}
          />
        </label>
        <label>
          TV location in Media
          <input
            value={tvLocation}
            required
            onChange={(event) => {
              setTvLocation(event.target.value);
            }}
          />
        </label>
      </fieldset>
      <button
        className="button primary"
        type="submit"
        disabled={
          create.isPending || selected.radarr === "" || selected.sonarr === ""
        }
      >
        {create.isPending ? "Comparing your library…" : "Build library report"}
      </button>
      {create.error !== null && <ErrorNotice error={create.error} />}
    </form>
  );
}
