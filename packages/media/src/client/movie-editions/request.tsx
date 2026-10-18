import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { MovieEditionContextV3 } from "#shared/movie-editions/view.ts";
import type {
  MovieRequestV3,
  MovieRequestResultV3,
} from "#shared/movie-editions/commands.ts";
import { ApiError, writeApi } from "#client/api.ts";
import { ErrorNotice, Loading, Notice } from "#client/components.tsx";
import {
  CommandError,
  commandNeedsReview,
} from "#client/target-controls/errors.tsx";
import {
  invalidateMovieRequests,
  movieRequest,
  readMovieContext,
  submitMovieRequest,
} from "./api.ts";
import { MovieEditionSelector } from "./selector.tsx";
import { MovieRequestSubject } from "./subject.tsx";
import { movieEditionReason } from "./presentation.ts";

type MovieTarget = { mediaId: string } | { externalId: number };

export function MovieRequestForm({
  user,
  target,
}: {
  user: MediaUser;
  target: MovieTarget;
}) {
  const [subjectUserId, setSubjectUserId] = useState(user.id);
  return (
    <>
      <MovieRequestSubject
        user={user}
        subjectUserId={subjectUserId}
        change={setSubjectUserId}
      />
      <SubjectMovieRequest
        key={subjectUserId}
        user={user}
        target={target}
        subjectUserId={subjectUserId}
      />
    </>
  );
}

function useMovieRequest({
  user,
  target,
  subjectUserId,
}: {
  user: MediaUser;
  target: MovieTarget;
  subjectUserId: string;
}) {
  const [edition, setEdition] = useState<MovieEditionKey | "">("");
  const [languages, setLanguages] = useState("en");
  const [reviewed, setReviewed] = useState<MovieEditionContextV3 | null>(null);
  const [adoptedId, setAdoptedId] = useState<string | null>(null);
  const pending = useRef<MovieRequestV3 | null>(null);
  const mediaId = "mediaId" in target ? target.mediaId : adoptedId;
  const context = useQuery({
    queryKey: ["movie-edition-context", mediaId, subjectUserId],
    enabled: mediaId !== null,
    queryFn: async () => {
      if (mediaId === null)
        throw new Error("Movie has not been added to the catalog.");
      return readMovieContext(mediaId, subjectUserId);
    },
    refetchOnWindowFocus: false,
  });
  const request = useMutation({
    mutationFn: async () => {
      if (pending.current !== null)
        return submitMovieRequest(user.id, pending.current);
      if (edition === "") throw new Error("Choose a movie edition first.");
      let current = reviewed ?? context.data;
      if (current === undefined) {
        if (!("externalId" in target))
          throw new Error("Movie choices have not loaded yet.");
        const adopted = await writeApi({
          actorId: user.id,
          path: "/catalog/adopt",
          body: { kind: "movie", externalId: target.externalId },
          schema: z.strictObject({ mediaId: z.uuid() }),
        });
        setAdoptedId(adopted.mediaId);
        current = await readMovieContext(adopted.mediaId, subjectUserId);
        setReviewed(current);
      }
      pending.current = movieRequest(current, edition, languages);
      return submitMovieRequest(user.id, pending.current);
    },
    onSuccess: async (result) => {
      pending.current = null;
      await invalidateMovieRequests(result.mediaId);
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      )
        pending.current = null;
    },
  });
  const review = useMutation({
    mutationFn: async () => {
      if (mediaId === null)
        throw new Error("Movie choices have not loaded yet.");
      return readMovieContext(mediaId, subjectUserId);
    },
    onSuccess: (current) => {
      setReviewed(current);
      pending.current = null;
      request.reset();
    },
  });
  const disabled =
    request.isPending ||
    review.isPending ||
    request.isSuccess ||
    pending.current !== null;
  const selected = (reviewed ?? context.data)?.options.find(
    (option) => option.edition === edition,
  );
  return {
    edition,
    setEdition,
    languages,
    setLanguages,
    setReviewed,
    mediaId,
    context,
    request,
    review,
    disabled,
    selected,
    chooseAnother: () => {
      setEdition("");
      setReviewed(null);
      request.reset();
    },
  };
}

function SubjectMovieRequest(input: {
  user: MediaUser;
  target: MovieTarget;
  subjectUserId: string;
}) {
  const { user } = input;
  const {
    edition,
    setEdition,
    languages,
    setLanguages,
    setReviewed,
    mediaId,
    context,
    request,
    review,
    disabled,
    selected,
    chooseAnother,
  } = useMovieRequest(input);
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        request.mutate();
      }}
    >
      <MovieEditionSelector
        value={edition}
        disabled={disabled}
        change={(value) => {
          setEdition(value);
          setReviewed(context.data ?? null);
        }}
      />
      <label>
        Subtitle languages
        <input
          value={languages}
          disabled={disabled}
          onChange={(event) => {
            setLanguages(event.target.value);
          }}
          placeholder="en, zh-CN"
        />
      </label>
      <p className="helper">
        A playable household copy is separate from whether your requested
        edition has been fulfilled.
      </p>
      {selected?.reasons.map((reason) => (
        <p className="helper" key={reason}>
          {movieEditionReason(reason)}
        </p>
      ))}
      {mediaId !== null && context.isPending && <Loading />}
      {context.error !== null && <ErrorNotice error={context.error} />}
      <button
        className="button primary"
        type="submit"
        disabled={
          request.isPending ||
          review.isPending ||
          request.isSuccess ||
          user.restricted ||
          edition === "" ||
          commandNeedsReview(request.error) ||
          (mediaId !== null && context.data === undefined)
        }
      >
        {request.isPending ? "Saving request…" : "Request selected edition"}
      </button>
      <CommandError
        error={request.error}
        review={() => {
          review.mutate();
        }}
      />
      {review.error !== null && <ErrorNotice error={review.error} />}
      <MovieRequestOutcome
        result={request.data}
        succeeded={request.isSuccess}
        chooseAnother={chooseAnother}
      />
    </form>
  );
}

function MovieRequestOutcome({
  result,
  succeeded,
  chooseAnother,
}: {
  result: MovieRequestResultV3 | undefined;
  succeeded: boolean;
  chooseAnother: () => void;
}) {
  return (
    <>
      {result !== undefined && (
        <Notice>
          {result.state === "pending"
            ? "Request saved and protected while your edition is pending."
            : "Your selected-edition request was added."}
        </Notice>
      )}
      {succeeded && (
        <button className="button subtle" type="button" onClick={chooseAnother}>
          Request another edition
        </button>
      )}
      {result?.reason !== null && result?.reason !== undefined && (
        <p role="status">{movieEditionReason(result.reason)}</p>
      )}
    </>
  );
}
