import { useId, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { SearchIcon } from "lucide-react";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { SubtitleTargetListSchema } from "#shared/admin.ts";
import {
  PrepareSubtitleReplacementSchema,
  SubtitleReplacementListSchema,
} from "#shared/subtitle-replacement.ts";
import { readApi, writeApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { Button, ButtonLink, ButtonRow } from "#client/ui/button.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, LoadError } from "#client/ui/feedback.tsx";
import { SelectField, TextField } from "#client/ui/forms/field.tsx";
import { FieldRow, Form, FormFooter } from "#client/ui/forms/form.tsx";
import { EmptyNote, Panel, SkeletonRows } from "#client/ui/panel.tsx";
import { SubtitleReplacementReview } from "./review.tsx";
import {
  REPLACEMENT_STATE,
  SUBTITLE_QUALITY,
  forcedLabel,
  phrase,
} from "./vocabulary.ts";

export function SubtitleReplacementPage({ user }: { user: MediaUser }) {
  const { id } = useParams();
  return id === undefined ? (
    <ReplacementIndex user={user} />
  ) : (
    <SubtitleReplacementReview key={`${user.id}:${id}`} user={user} id={id} />
  );
}

function ReplacementIndex({ user }: { user: MediaUser }) {
  return (
    <>
      <PageTitle title="Subtitle replacement">
        <p>
          Review an exact, validated replacement for an owned installed sidecar.
          Videos and embedded subtitles are not changed.
        </p>
        <p>
          <ButtonLink to="/manage/subtitles">
            Add a replacement candidate
          </ButtonLink>
        </p>
      </PageTitle>
      <PrepareReview user={user} />
      <ReplacementList />
    </>
  );
}

/** Step 1: choose the installed subtitle and the validated one that replaces it. */
function PrepareReview({ user }: { user: MediaUser }) {
  const [search, setSearch] = useState("");
  const headingId = useId();
  const navigate = useNavigate();
  const targets = useQuery({
    queryKey: ["subtitle-targets", search],
    queryFn: () =>
      readApi(
        `/admin/subtitles/targets?q=${encodeURIComponent(search)}`,
        SubtitleTargetListSchema,
      ),
  });
  const prepare = useMutation({
    mutationFn: async (form: FormData) => {
      const subtitles =
        targets.data?.flatMap((target) => target.subtitles) ?? [];
      const old = subtitles.find((subtitle) => subtitle.id === form.get("old"));
      const candidate = subtitles.find(
        (subtitle) => subtitle.id === form.get("candidate"),
      );
      if (old === undefined || candidate === undefined)
        throw new Error(
          "Select the installed subtitle and validated candidate.",
        );
      return writeApi({
        actorId: user.id,
        path: "/admin/subtitle-replacements",
        schema: CommandResultSchema,
        body: PrepareSubtitleReplacementSchema.parse({
          oldSubtitleId: old.id,
          candidateSubtitleId: candidate.id,
          expectedOldVersion: old.version,
          expectedCandidateVersion: candidate.version,
        }),
      });
    },
    onSuccess: (result) => {
      if (result.subtitleReplacementId !== undefined)
        void navigate(
          `/manage/subtitles/replacements/${result.subtitleReplacementId}`,
        );
    },
  });
  function find(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("query");
    if (typeof query !== "string") throw new TypeError("Missing query");
    setSearch(query);
  }
  return (
    <Panel
      id="prepare"
      title="1. Prepare a review"
      description={
        <p>
          Choose two records for the same video, language, forced or
          hearing-impaired kind, and filename. Preparing checks the files and
          replaces nothing: you approve the exact replacement on the next page.
        </p>
      }
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
              Search library
            </Button>
          </FieldRow>
        </form>
      </search>
      <h3 className="sr-only" id={headingId}>
        Replacement choice
      </h3>
      {targets.isPending && (
        <SkeletonRows label="Loading videos" rows={2} tall />
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
            ? "Your library has no videos with subtitles to replace yet."
            : `No video matches “${search}”. Try part of the title.`}
        </EmptyNote>
      )}
      {targets.data !== undefined && targets.data.length > 0 && (
        <Form
          labelledBy={headingId}
          onSubmit={(form) => {
            prepare.mutate(new FormData(form));
          }}
        >
          <SelectField
            label="Installed sidecar"
            name="old"
            required
            requiredMessage="Choose the subtitle that is installed now."
            defaultValue=""
          >
            <option value="" disabled>
              Select the current subtitle
            </option>
            {targets.data.flatMap((target) =>
              target.subtitles
                .filter(
                  (subtitle) =>
                    subtitle.state === "installed" &&
                    subtitle.storageKind === "sidecar",
                )
                .map((subtitle) => (
                  <option key={subtitle.id} value={subtitle.id}>
                    {target.titles.join(", ")}: {subtitle.filename},{" "}
                    {SUBTITLE_QUALITY[subtitle.qualityStatus].toLowerCase()}
                  </option>
                )),
            )}
          </SelectField>
          <SelectField
            label="Validated replacement"
            name="candidate"
            required
            requiredMessage="Choose the validated subtitle that replaces it."
            defaultValue=""
          >
            <option value="" disabled>
              Select validated bytes
            </option>
            {targets.data.flatMap((target) =>
              target.subtitles
                .filter(
                  (subtitle) =>
                    subtitle.state === "validated" &&
                    subtitle.qualityStatus === "accepted",
                )
                .map((subtitle) => (
                  <option key={subtitle.id} value={subtitle.id}>
                    {target.titles.join(", ")}: {subtitle.language},{" "}
                    {forcedLabel(subtitle.forced).toLowerCase()},{" "}
                    {subtitle.providerId}, {subtitle.id.slice(0, 8)}
                  </option>
                )),
            )}
          </SelectField>
          <FormFooter
            submitLabel="Prepare replacement review"
            pendingLabel="Preparing…"
            pending={prepare.isPending}
            error={prepare.error}
            note="Preparing checks files and replaces nothing."
          />
        </Form>
      )}
    </Panel>
  );
}

/** Step 2: every replacement that has been prepared, and where it stands. */
function ReplacementList() {
  const [cursor, setCursor] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["subtitle-replacements", cursor],
    queryFn: () =>
      readApi(
        `/admin/subtitle-replacements${cursor === null ? "" : `?cursor=${cursor}`}`,
        SubtitleReplacementListSchema,
      ),
    refetchInterval: 5000,
  });
  const next = list.data?.nextCursor ?? null;
  return (
    <Panel
      id="reviews"
      title="2. Replacement reviews"
      description={
        <p>
          Each review is compared with the subtitle it would replace before
          anything is swapped. Open one to approve it or to see what happened.
        </p>
      }
    >
      {list.isPending && <SkeletonRows label="Loading reviews" rows={3} />}
      {list.error !== null && (
        <LoadError
          what="Replacement reviews"
          error={list.error}
          retry={() => {
            void list.refetch();
          }}
        />
      )}
      {list.data?.items.length === 0 && (
        <EmptyNote>
          No replacements have been prepared. Prepare one above.
        </EmptyNote>
      )}
      {list.data !== undefined && list.data.items.length > 0 && (
        <DataList label="Replacement reviews">
          {list.data.items.map((item) => {
            const state = REPLACEMENT_STATE[item.state];
            return (
              <DataRow
                key={item.id}
                title={item.titles.map((title) => title.title).join(", ")}
                detail={
                  <>
                    <p>{item.destinationName}</p>
                    {item.reason !== null && <p>{phrase(item.reason)}</p>}
                    {item.reservationActive && (
                      <p>
                        Held until this review is applied or safely reconciled.
                      </p>
                    )}
                  </>
                }
                status={<Badge tone={state.tone}>{state.label}</Badge>}
                actions={
                  <ButtonLink to={`/manage/subtitles/replacements/${item.id}`}>
                    Open review
                  </ButtonLink>
                }
              />
            );
          })}
        </DataList>
      )}
      {(cursor !== null || next !== null) && (
        <ButtonRow>
          {cursor !== null && (
            <Button
              onClick={() => {
                setCursor(null);
              }}
            >
              First page
            </Button>
          )}
          {next !== null && (
            <Button
              onClick={() => {
                setCursor(next);
              }}
            >
              Next page
            </Button>
          )}
        </ButtonRow>
      )}
    </Panel>
  );
}
