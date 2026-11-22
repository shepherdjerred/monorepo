import { useState } from "react";
import { CheckIcon } from "lucide-react";
import type { MediaUser } from "#shared/contract.ts";
import type { DefaultCommandV2 } from "#shared/editions/commands.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import type { MovieTargetContextV4 } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { ApiError } from "#client/api.ts";
import { ErrorNotice } from "#client/components.tsx";
import {
  movieProtectionSubmission,
  unresolvedMovieProtection,
  useMovieProtection,
} from "#client/movie-editions/protection-v4.ts";
import {
  invalidateMovieTargetV4,
  useMovieLifecycleCommandV4,
} from "#client/movie-editions/target-api-v4.ts";
import { invalidateTarget } from "#client/target-controls/api.ts";
import {
  CommandError,
  commandNeedsReview,
} from "#client/target-controls/errors.tsx";
import { useTargetCommand } from "#client/target-controls/mutation.ts";
import { classNames } from "#client/ui/class-names.ts";
import { COMMAND_COPY, type TargetCommand, type TitleCommand } from "./copy.ts";
import { cancellableRequest, cancellableVersionRequest } from "./facts.ts";
import styles from "./title.module.css";

const cx = classNames(styles);

/** How a page runs a title's commands and what it has to say about them. */
export type CommandRunner<Command extends TitleCommand = TitleCommand> = {
  run: (command: Command) => void;
  /** Nothing may start: a command is in flight or the last one is unsettled. */
  busy: boolean;
  /** The command in flight, for the button that started it. */
  pending: Command | null;
  /** The confirmation of the last command, in its button's own word. */
  done: string | null;
  error: Error | null;
  /**
   * Why the server refused the last command, in the reader's words, for a
   * refusal the page expects. The page has read the title again by then.
   */
  notice: string | null;
  /** Sends the last command again exactly as it was, when its outcome is unknown. */
  retry: (() => void) | null;
  /** Reads the title again after it changed under a command. */
  review: () => void;
};

/** A refusal is an answer; anything else may or may not have been applied. */
export function outcomeUnknown(error: Error | null): boolean {
  return (
    error !== null &&
    !(error instanceof ApiError && error.status >= 400 && error.status < 500)
  );
}

/** The confirmation of a finished command, in its button's own word. */
export function confirmation(
  command: TitleCommand | null,
  finished: "queued" | "completed" | null,
): string | null {
  if (command === null || finished === null) return null;
  const copy = COMMAND_COPY[command];
  return finished === "queued" ? copy.started : copy.done;
}

const TELEVISION_ACTIONS = {
  hold: "keep",
  pin: "pin",
  unpin: "unpin",
  restore: "restore",
} as const satisfies Record<
  Exclude<TargetCommand, "cancel_request">,
  DefaultCommandV2["command"]["action"]
>;

function televisionCommand(
  command: TargetCommand,
  context: DefaultTargetView,
  user: MediaUser,
): DefaultCommandV2["command"] {
  if (command !== "cancel_request") {
    return { action: TELEVISION_ACTIONS[command] };
  }
  const request = cancellableRequest(context, user);
  if (request === undefined) {
    throw new Error("There is no request of yours to cancel");
  }
  return {
    action: "cancel_request",
    requestId: request.id,
    requestVersion: request.version,
  };
}

/**
 * Runs the commands of a series, season or episode against the versions the
 * page read. One command at a time: after one succeeds the buttons wait for
 * the page to read the title again, so nothing is sent against stale
 * versions.
 */
export function useTelevisionRunner(
  user: MediaUser,
  context: DefaultTargetView,
): CommandRunner<TargetCommand> {
  const mutation = useTargetCommand(user.id);
  const [last, setLast] = useState<TargetCommand | null>(null);
  const sent = mutation.variables?.context.expected;
  const settling =
    mutation.isSuccess &&
    sent?.mediaVersion === context.expected.mediaVersion &&
    sent.targetVersion === context.expected.targetVersion;
  const unknown = outcomeUnknown(mutation.error);
  return {
    run: (command) => {
      setLast(command);
      mutation.submit({
        context,
        command: televisionCommand(command, context, user),
      });
    },
    busy:
      mutation.isPending ||
      settling ||
      unknown ||
      commandNeedsReview(mutation.error),
    pending: mutation.isPending ? last : null,
    done: confirmation(
      last,
      mutation.data === undefined
        ? null
        : (mutation.data.result.status ?? "completed"),
    ),
    error: mutation.error,
    notice: null,
    retry:
      unknown && mutation.variables !== undefined
        ? () => {
            mutation.mutate(mutation.variables);
          }
        : null,
    review: () => {
      mutation.reset();
      void invalidateTarget(context.scope.mediaId);
    },
  };
}

const VERSION_ACTIONS = {
  hold: "keep",
  pin: "pin",
  unpin: "unpin",
  restore: "restore",
} as const;

/** One of the writes a runner is made of, as the runner sees it. */
export type Part = {
  busy: boolean;
  isPending: boolean;
  /** How the last write ended, once it has. */
  finished: "queued" | "completed" | null;
  error: Error | null;
  retry: (() => void) | null;
  review: () => void;
};

/** Keeping, letting go and restoring: commands against the version itself. */
function useVersionLifecycle(user: MediaUser, version: MovieTargetContextV4) {
  const mutation = useMovieLifecycleCommandV4(user.id);
  const sent = mutation.variables?.expected;
  const settling =
    mutation.isSuccess &&
    sent?.mediaVersion === version.expected.mediaVersion &&
    sent.targetVersion === version.expected.targetVersion;
  const part: Part = {
    busy:
      mutation.isPending ||
      settling ||
      mutation.unresolved !== null ||
      commandNeedsReview(mutation.error),
    isPending: mutation.isPending,
    finished:
      mutation.data === undefined
        ? null
        : (mutation.data.result.status ?? "completed"),
    error: mutation.error,
    retry: mutation.unresolved === null ? null : mutation.retryOriginal,
    review: mutation.reset,
  };
  return {
    part,
    submit: (command: Exclude<TargetCommand, "cancel_request">) => {
      mutation.submit(version, { action: VERSION_ACTIONS[command] });
    },
  };
}

/** Withdrawing the reader's own request for the version. */
function useVersionStop(user: MediaUser, version: MovieTargetContextV4) {
  const mutation = useMovieProtection();
  const unresolved = unresolvedMovieProtection(mutation);
  const stopping = mutation.variables?.body.requestId;
  // Until the page reads the version again, the request still looks active.
  const settling =
    mutation.isSuccess &&
    version.ownRequests.some(
      (request) => request.active && request.id === stopping,
    );
  const part: Part = {
    busy:
      mutation.isPending ||
      settling ||
      unresolved !== null ||
      commandNeedsReview(mutation.error),
    isPending: mutation.isPending,
    finished: mutation.data === undefined ? null : "completed",
    error: mutation.error,
    retry:
      unresolved === null
        ? null
        : () => {
            mutation.submit(unresolved);
          },
    review: mutation.reset,
  };
  return {
    part,
    submit: () => {
      const request = cancellableVersionRequest(version);
      if (request === undefined) {
        throw new Error("There is no request of yours to cancel");
      }
      mutation.submit(
        movieProtectionSubmission({
          actorId: user.id,
          subjectUserId: user.id,
          request: {
            scope: version.scope,
            requestId: request.id,
            targetVersion: version.expected.targetVersion,
            requestVersion: request.version,
            choiceRevision: request.choiceRevision,
          },
          action: "cancel_request",
        }),
      );
    },
  };
}

/**
 * Runs the commands of one version of a film. A command whose outcome is
 * unknown must be sent again as it was before anything else is tried, which
 * is what `retry` does.
 */
export function useVersionRunner(
  user: MediaUser,
  version: MovieTargetContextV4,
): CommandRunner<TargetCommand> {
  const lifecycle = useVersionLifecycle(user, version);
  const stop = useVersionStop(user, version);
  const [last, setLast] = useState<TargetCommand | null>(null);
  const { finished } = last === "cancel_request" ? stop.part : lifecycle.part;
  return {
    run: (command) => {
      setLast(command);
      if (command === "cancel_request") stop.submit();
      else lifecycle.submit(command);
    },
    busy: lifecycle.part.busy || stop.part.busy,
    pending: lifecycle.part.isPending || stop.part.isPending ? last : null,
    done: confirmation(last, finished),
    error: lifecycle.part.error ?? stop.part.error,
    notice: null,
    retry: lifecycle.part.retry ?? stop.part.retry,
    review: () => {
      lifecycle.part.review();
      stop.part.review();
      void invalidateMovieTargetV4(version.scope.mediaId);
    },
  };
}

/** What the last command did, or why it did not, under the buttons. */
export function CommandFeedback({
  runner,
}: {
  runner: Pick<CommandRunner, "done" | "error" | "notice" | "retry" | "review">;
}) {
  const { error, retry } = runner;
  if (runner.notice !== null) {
    return (
      <p className={cx("notice")} role="status">
        {runner.notice}
      </p>
    );
  }
  if (error === null) {
    return runner.done === null ? null : (
      <p className={cx("done")} role="status">
        <CheckIcon aria-hidden="true" />
        {runner.done}
      </p>
    );
  }
  if (commandNeedsReview(error)) {
    return <CommandError error={error} review={runner.review} />;
  }
  return (
    <div className={cx("failure")}>
      <ErrorNotice error={error} />
      {retry !== null && (
        <>
          <p className={cx("failureNote")}>
            Media does not know whether that went through. Try it again before
            doing anything else.
          </p>
          <button className="button" type="button" onClick={retry}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}
