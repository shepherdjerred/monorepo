import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { MediaDetailSchema } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import type { MovieRequestV4 } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { ApiError, queryClient, readApi, writeApi } from "#client/api.ts";
import { invalidateMovieRequests } from "#client/movie-editions/api.ts";
import {
  movieRequestV4,
  readMovieContextV4,
  submitMovieRequestV4,
} from "#client/movie-editions/request-api-v4.ts";
import { movieAdmissionReasonV4 } from "#client/movie-editions/presentation-v4.ts";
import {
  invalidateTarget,
  readTarget,
  writeTarget,
} from "#client/target-controls/api.ts";
import type { TargetSubmission } from "#client/target-controls/mutation.ts";
import {
  chosenSeasons,
  movieOptions,
  partialMessage,
  requestItems,
  televisionCommand,
  type RequestItem,
  type SheetSubject,
  type SheetValues,
  type TelevisionSubject,
} from "./form.ts";

/** What a sent request leaves behind for the sheet to say. */
export type RequestOutcome = {
  /** The library item the request now belongs to. */
  mediaId: string;
  /** Something the reader should know about the request, when there is. */
  note: string | null;
};

const AdoptedSchema = z.strictObject({ mediaId: z.uuid() });

/** Adds a catalog title to the library so that it can be asked for. */
async function adopt(
  user: MediaUser,
  kind: "movie" | "series",
  externalId: number,
) {
  const adopted = await writeApi({
    actorId: user.id,
    path: "/catalog/adopt",
    body: { kind, externalId },
    schema: AdoptedSchema,
  });
  return adopted.mediaId;
}

/** A refusal is final; anything else may have been applied and is retried as sent. */
function refused(error: Error): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

/** Lists that show whether a title is asked for. */
async function invalidateLists() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["library"] }),
    queryClient.invalidateQueries({ queryKey: ["catalog-detail"] }),
    queryClient.invalidateQueries({ queryKey: ["request-interests"] }),
  ]);
}

/** A request for several seasons that has begun and is not finished. */
type Batch = {
  /** The answers the first command was sent with, and every later one is. */
  values: SheetValues;
  /** What has been accepted so far, in the order it was sent. */
  accepted: readonly RequestItem[];
};

/**
 * Asks for a series, some of its seasons, a season or an episode.
 *
 * Each item is one command against the versions read for it just before. A
 * command whose outcome is unknown is kept and sent again unchanged, so the
 * server recognises it.
 *
 * Once one season of several is accepted, the request is finished with the
 * answers it began with: what was accepted cannot be taken back from here,
 * so the remaining seasons are asked for the same way and the sheet's
 * answers stay locked until they are. Accepted seasons are not asked for
 * twice.
 */
export function useTelevisionRequest(
  user: MediaUser,
  subject: TelevisionSubject,
) {
  const adopted = useRef<string | null>(null);
  const batch = useRef<Batch | null>(null);
  const unacknowledged = useRef<TargetSubmission | null>(null);
  const request = useMutation({
    mutationFn: async (submitted: SheetValues): Promise<RequestOutcome> => {
      const values = batch.current?.values ?? submitted;
      const { target } = subject;
      const rootId =
        "mediaId" in target
          ? target.mediaId
          : (adopted.current ??= await adopt(
              user,
              "series",
              target.externalId,
            ));
      const seasons = chosenSeasons(subject, values);
      const items = requestItems(
        subject,
        rootId,
        seasons,
        seasons.length === 0 ? [] : await seasonsOf(rootId),
      );
      for (const item of items) {
        const accepted = batch.current?.accepted ?? [];
        if (accepted.some((done) => done.mediaId === item.mediaId)) continue;
        const held = unacknowledged.current;
        const submission =
          held?.context.scope.mediaId === item.mediaId
            ? held
            : {
                context: await readTarget(item.mediaId),
                command: televisionCommand(values, user, item.scope),
              };
        unacknowledged.current = submission;
        await writeTarget(user.id, submission.context, submission.command);
        unacknowledged.current = null;
        batch.current = { values, accepted: [...accepted, item] };
      }
      return { mediaId: rootId, note: null };
    },
    onSuccess: async (outcome) => {
      const accepted = batch.current?.accepted ?? [];
      batch.current = null;
      await Promise.all([
        invalidateTarget(outcome.mediaId),
        ...accepted.map((item) => invalidateTarget(item.mediaId)),
        invalidateLists(),
      ]);
    },
    onError: (error) => {
      if (refused(error)) unacknowledged.current = null;
    },
  });
  const begun = batch.current;
  return {
    request,
    /**
     * The answers cannot change: a command is in flight, one has an unknown
     * outcome and must be retried as it was sent, or part of the request is
     * already accepted.
     */
    locked:
      request.isPending || unacknowledged.current !== null || begun !== null,
    /** What a request that stopped part-way has and has not asked for. */
    partial:
      begun === null || request.isPending || request.isSuccess
        ? null
        : partialMessage(subject, ...progress(subject, begun)),
    review: () => {
      unacknowledged.current = null;
      request.reset();
    },
  };
}

/** The seasons a batch has asked for, and the ones it still has to. */
function progress(
  subject: TelevisionSubject,
  batch: Batch,
): [requested: number[], remaining: number[]] {
  const requested = batch.accepted.flatMap((item) =>
    item.seasonNumber === null ? [] : [item.seasonNumber],
  );
  return [
    requested,
    chosenSeasons(subject, batch.values).filter(
      (season) => !requested.includes(season),
    ),
  ];
}

/** The series' items in the library, among them its seasons. */
async function seasonsOf(rootId: string) {
  const series = await readApi(
    `/media/${encodeURIComponent(rootId)}`,
    MediaDetailSchema,
  );
  return series.children;
}

/**
 * Asks for one version of a film, for the reader or a profile the owner
 * manages. The request names the versions the sheet showed, so a film that
 * changed meanwhile is refused instead of overwritten.
 */
export function useMovieRequest(
  user: MediaUser,
  subject: Extract<SheetSubject, { kind: "movie" }>,
  subjectUserId: string,
) {
  const { target } = subject;
  const [adoptedId, setAdoptedId] = useState<string | null>(null);
  const unacknowledged = useRef<MovieRequestV4 | null>(null);
  const mediaId = "mediaId" in target ? target.mediaId : adoptedId;
  const context = useQuery({
    queryKey: ["movie-edition-context", 4, mediaId, subjectUserId],
    enabled: mediaId !== null,
    queryFn: async () => {
      if (mediaId === null) throw new Error("The film is not in the library");
      return readMovieContextV4(mediaId, subjectUserId);
    },
    refetchOnWindowFocus: false,
  });
  const request = useMutation({
    mutationFn: async (values: SheetValues): Promise<RequestOutcome> => {
      if (unacknowledged.current === null) {
        let observed = context.data;
        if (observed === undefined) {
          if (!("externalId" in target)) {
            throw new Error("The film’s versions have not loaded yet.");
          }
          const adopted = await adopt(user, "movie", target.externalId);
          setAdoptedId(adopted);
          observed = await readMovieContextV4(adopted, subjectUserId);
        }
        const { subtitleLanguages, keepingPolicy } = movieOptions(values);
        unacknowledged.current = movieRequestV4(
          observed,
          values.version,
          subtitleLanguages,
          keepingPolicy,
        );
      }
      const result = await submitMovieRequestV4(
        user.id,
        unacknowledged.current,
      );
      if (result.reason !== null) {
        return {
          mediaId: result.mediaId,
          note: movieAdmissionReasonV4(result.reason),
        };
      }
      return {
        mediaId: result.mediaId,
        note:
          result.state === "pending"
            ? "Your request is saved and the film is kept for you. Media starts looking as soon as it can."
            : null,
      };
    },
    onSuccess: async (outcome) => {
      unacknowledged.current = null;
      await Promise.all([
        invalidateMovieRequests(outcome.mediaId),
        invalidateLists(),
      ]);
    },
    onError: (error) => {
      if (refused(error)) unacknowledged.current = null;
    },
  });
  return {
    request,
    context,
    locked: request.isPending || unacknowledged.current !== null,
    review: () => {
      unacknowledged.current = null;
      request.reset();
      void context.refetch();
    },
  };
}
