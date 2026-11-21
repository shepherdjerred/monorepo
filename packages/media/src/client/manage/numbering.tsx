import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { CommandResultSchema } from "#shared/api.ts";
import {
  NumberingEpisodeListSchema,
  NumberingSeriesListSchema,
  SaveEpisodeNumberingSchema,
  type SaveEpisodeNumbering,
} from "#shared/numbering.ts";
import { NumberingGroups } from "#client/acquisition-identity/numbering-groups.tsx";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { useUser } from "#client/shell/user.ts";
import { Button, ButtonRow } from "#client/ui/button.tsx";
import { Badge, LoadError } from "#client/ui/feedback.tsx";
import { SelectField, TextAreaField, TextField } from "#client/ui/field.tsx";
import { Form, FormFooter, useSavedNotes } from "#client/ui/form.tsx";
import {
  Disclosure,
  DisclosureList,
  EmptyNote,
  Section,
  SkeletonRows,
} from "#client/ui/section.tsx";

type Episode = z.infer<typeof NumberingEpisodeListSchema>[number];

/** How many episodes the server lists at a time. */
const PAGE_SIZE = 200;

/** Which control a schema issue belongs to. */
const FIELD_BY_PATH: Readonly<Record<string, string>> = {
  absoluteNumber: "absolute",
  evidence: "evidence",
};

/** The form as the body the API accepts, before the schema has checked it. */
function numberingInput(form: HTMLFormElement, episode: Episode) {
  const fields = new FormData(form);
  return {
    expectedVersion: episode.version,
    absoluteNumber:
      fields.get("absolute") === "" ? null : Number(fields.get("absolute")),
    evidence: fields.get("evidence"),
  };
}

const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  absolute: "Enter a whole number, 1 or more, or leave this empty.",
  evidence: "Give at least ten characters about where this number comes from.",
};

function episodeName(episode: Episode): string {
  return `S${String(episode.seasonNumber)} E${String(episode.episodeNumber)}`;
}

function EpisodeForm({
  episode,
  headingId,
  saved,
  onSaved,
  onEdit,
}: {
  episode: Episode;
  headingId: string;
  saved: string | null;
  onSaved: (message: string) => void;
  onEdit: () => void;
}) {
  const user = useUser();
  const save = useMutation({
    mutationFn: async (input: SaveEpisodeNumbering) =>
      writeApi({
        actorId: user.id,
        path: `/admin/numbering/episodes/${episode.id}`,
        method: "PUT",
        body: input,
        schema: CommandResultSchema,
      }),
    onSuccess: async (_result, input) => {
      onSaved(
        input.absoluteNumber === null
          ? `Release number removed from ${episodeName(episode)}.`
          : `${episodeName(episode)} saved as release number ${String(input.absoluteNumber)}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["numbering-episodes"] });
    },
  });
  return (
    <Form
      labelledBy={headingId}
      validate={(form) => {
        const read = SaveEpisodeNumberingSchema.safeParse(
          numberingInput(form, episode),
        );
        const problems: Record<string, string> = {};
        for (const issue of read.error?.issues ?? []) {
          const field = FIELD_BY_PATH[issue.path.join(".")];
          const message =
            field === undefined ? undefined : FIELD_MESSAGES[field];
          if (field !== undefined && message !== undefined) {
            problems[field] = message;
          }
        }
        return problems;
      }}
      onSubmit={(form) => {
        // Anything the fields could not explain is a broken contract: throw.
        save.mutate(
          SaveEpisodeNumberingSchema.parse(numberingInput(form, episode)),
        );
      }}
      onEdit={onEdit}
    >
      <TextField
        label="Release number"
        description="The number releases use for this episode. Leave it empty to remove the number."
        optional
        name="absolute"
        type="number"
        min="1"
        step="1"
        defaultValue={episode.absoluteNumber ?? ""}
      />
      <TextAreaField
        label="Where this number comes from"
        description="The source you checked, such as the series’ AniDB or TMDB page."
        name="evidence"
        required
        requiredMessage="Say where this number comes from."
        minLength={10}
        maxLength={2000}
        rows={2}
        defaultValue={episode.evidence ?? ""}
      />
      <FormFooter
        submitLabel="Save number"
        pendingLabel="Saving…"
        pending={save.isPending}
        saved={saved}
        error={save.error}
      />
    </Form>
  );
}

function EpisodeRow({
  episode,
  notes,
}: {
  episode: Episode;
  notes: ReturnType<typeof useSavedNotes>;
}) {
  const headingId = useId();
  return (
    <Disclosure
      title={`${episodeName(episode)}: ${episode.title}`}
      titleId={headingId}
      meta={
        episode.absoluteNumber === null ? (
          <Badge>No release number</Badge>
        ) : (
          <Badge tone="ok">Release number {episode.absoluteNumber}</Badge>
        )
      }
    >
      <EpisodeForm
        // A saved episode comes back with a new version; start its form again.
        key={episode.version}
        episode={episode}
        headingId={headingId}
        saved={notes.note(episode.id)}
        onSaved={(message) => {
          notes.saved(episode.id, message);
        }}
        onEdit={() => {
          notes.edited(episode.id);
        }}
      />
    </Disclosure>
  );
}

function Episodes({ seriesId }: { seriesId: string }) {
  const [offset, setOffset] = useState(0);
  const notes = useSavedNotes();
  const episodes = useQuery({
    queryKey: ["numbering-episodes", seriesId, offset],
    queryFn: async () =>
      readApi(
        `/admin/numbering/series/${seriesId}?offset=${String(offset)}`,
        NumberingEpisodeListSchema,
      ),
  });
  return (
    <Section
      title="Episodes"
      description="Open an episode to set or change its release number."
    >
      {episodes.isPending && <SkeletonRows label="Loading episodes" rows={6} />}
      {episodes.error !== null && (
        <LoadError
          what="Episodes"
          error={episodes.error}
          retry={() => {
            void episodes.refetch();
          }}
        />
      )}
      {episodes.data?.length === 0 && (
        <EmptyNote>
          {offset === 0
            ? "This series has no episodes in the library yet."
            : "There are no more episodes."}
        </EmptyNote>
      )}
      {episodes.data !== undefined && episodes.data.length > 0 && (
        <DisclosureList>
          {episodes.data.map((episode) => (
            <EpisodeRow key={episode.id} episode={episode} notes={notes} />
          ))}
        </DisclosureList>
      )}
      <ButtonRow>
        <Button
          disabled={offset === 0}
          onClick={() => {
            setOffset(Math.max(0, offset - PAGE_SIZE));
          }}
        >
          Previous episodes
        </Button>
        <Button
          disabled={episodes.data?.length !== PAGE_SIZE}
          onClick={() => {
            setOffset(offset + PAGE_SIZE);
          }}
        >
          Next episodes
        </Button>
      </ButtonRow>
    </Section>
  );
}

export function NumberingPage() {
  const user = useUser();
  const [query, setQuery] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const series = useQuery({
    queryKey: ["numbering-series", query],
    queryFn: async () =>
      readApi(
        `/admin/numbering/series?q=${encodeURIComponent(query)}`,
        NumberingSeriesListSchema,
      ),
  });
  return (
    <>
      <PageTitle title="Numbering">
        <p>Correct how a release’s episode numbers map to a series.</p>
      </PageTitle>
      <Section
        title="Choose a series"
        description="Some anime releases number episodes from the first one ever aired, not by season. Give each episode its release number so those releases can be matched. Nothing here renames a season or an episode in Plex."
      >
        <TextField
          label="Find a series"
          description="The list below narrows as you type."
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          width="medium"
        />
        <SelectField
          label="Series"
          value={seriesId}
          onChange={(event) => {
            setSeriesId(event.target.value);
          }}
        >
          <option value="">Choose a series</option>
          {series.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
              {item.year === null ? "" : ` (${String(item.year)})`}
            </option>
          ))}
        </SelectField>
        {series.error !== null && (
          <LoadError
            what="Series"
            error={series.error}
            retry={() => {
              void series.refetch();
            }}
          />
        )}
        {series.data?.length === 0 && (
          <EmptyNote>
            {query === ""
              ? "Your library has no series to number yet."
              : `No series matches “${query}”.`}
          </EmptyNote>
        )}
      </Section>
      {seriesId !== "" && (
        <>
          <NumberingGroups key={seriesId} user={user} seriesId={seriesId} />
          <Episodes key={`episodes:${seriesId}`} seriesId={seriesId} />
        </>
      )}
    </>
  );
}
