import { useState, type ReactNode } from "react";
import type { MediaUser } from "#shared/contract.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { movieAdmissionReasonV4 } from "#client/movie-editions/presentation-v4.ts";
import { VERSION_COPY, VERSION_HINT } from "#client/presentation/version.ts";
import {
  CommandError,
  commandNeedsReview,
} from "#client/target-controls/errors.tsx";
import {
  Sheet,
  SheetActions,
  SheetBody,
  closeSheet,
} from "#client/ui/sheet.tsx";
import { Choice, LanguagePicker, Note, Problem } from "./controls.tsx";
import { Episodes, ForWhom, Keeping, Seasons } from "./fields.tsx";
import {
  initialValues,
  readVersion,
  validationMessage,
  type SheetSubject,
  type SheetValues,
} from "./form.ts";
import {
  useMovieRequest,
  useTelevisionRequest,
  type RequestOutcome,
} from "./submit.ts";

type Props = {
  user: MediaUser;
  subject: SheetSubject;
  /** The sheet closed: stop rendering it. */
  onClose: () => void;
  /** The request was accepted, for this library item. */
  onRequested?: (outcome: { mediaId: string }) => void;
};

type FormProps<Subject extends SheetSubject> = {
  user: MediaUser;
  subject: Subject;
  onRequested: (outcome: { mediaId: string }) => void;
};

/** The sheet once the request is in: what happened, in the button's own word. */
function Requested({
  subject,
  outcome,
  another,
}: {
  subject: SheetSubject;
  outcome: RequestOutcome;
  another?: () => void;
}) {
  return (
    <>
      <SheetBody>
        <p role="status">
          Requested. Media will let you know when {subject.title} is ready to
          watch.
        </p>
        {outcome.note !== null && <Note>{outcome.note}</Note>}
      </SheetBody>
      <SheetActions>
        {another !== undefined && (
          <button className="button" type="button" onClick={another}>
            Request another version
          </button>
        )}
        <button
          className="button primary"
          type="button"
          // The button that sent the request is gone; focus moves here.
          ref={(button) => {
            button?.focus();
          }}
          onClick={(event) => {
            closeSheet(event.currentTarget);
          }}
        >
          Done
        </button>
      </SheetActions>
    </>
  );
}

/** Brings what stopped the request into view; the body may have scrolled. */
function reveal(problems: HTMLDivElement | null) {
  problems?.scrollIntoView({ block: "nearest" });
}

/** The form's own frame: its fields, what is wrong, and the two buttons. */
function RequestForm({
  user,
  problem,
  error,
  pending,
  blocked,
  onSubmit,
  onReview,
  children,
}: {
  user: MediaUser;
  /** Why the sheet cannot be sent as it stands. */
  problem: string | null;
  error: Error | null;
  pending: boolean;
  /** Something the sheet needs has not loaded. */
  blocked: boolean;
  onSubmit: () => void;
  onReview: () => void;
  children: ReactNode;
}) {
  const [attempted, setAttempted] = useState(false);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (problem === null) onSubmit();
      }}
    >
      <SheetBody>
        {children}
        {user.restricted && (
          <Problem>
            Requests are paused for your account. Ask the library owner.
          </Problem>
        )}
        {((attempted && problem !== null) || error !== null) && (
          // Keyed by what is wrong, so a new problem is revealed again.
          <div key={`${problem ?? ""}:${error?.message ?? ""}`} ref={reveal}>
            {attempted && problem !== null && <Problem>{problem}</Problem>}
            <CommandError error={error} review={onReview} />
          </div>
        )}
      </SheetBody>
      <SheetActions>
        <button
          className="button"
          type="button"
          onClick={(event) => {
            closeSheet(event.currentTarget);
          }}
        >
          Cancel
        </button>
        <button
          className="button primary"
          type="submit"
          disabled={
            pending || blocked || user.restricted || commandNeedsReview(error)
          }
        >
          {pending ? "Requesting…" : "Request"}
        </button>
      </SheetActions>
    </form>
  );
}

function useSheetValues(subject: SheetSubject, user: MediaUser) {
  const [values, setValues] = useState(() => initialValues(subject, user));
  return {
    values,
    change: (patch: Partial<SheetValues>) => {
      setValues((current) => ({ ...current, ...patch }));
    },
  };
}

function MovieRequest({
  user,
  subject,
  onRequested,
}: FormProps<Extract<SheetSubject, { kind: "movie" }>>) {
  const { values, change } = useSheetValues(subject, user);
  const { request, context, locked, review } = useMovieRequest(
    user,
    subject,
    values.requesterUserId,
  );
  if (request.data !== undefined) {
    return (
      <Requested
        subject={subject}
        outcome={request.data}
        another={() => {
          change({ keeping: user.role === "owner" ? "" : "temporary" });
          request.reset();
        }}
      />
    );
  }
  const chosen = context.data?.options.find(
    (option) => option.edition === values.version,
  );
  return (
    <RequestForm
      user={user}
      problem={validationMessage(subject, values)}
      error={request.error ?? context.error}
      pending={request.isPending}
      // A film already in the library is asked for at the versions shown.
      blocked={"mediaId" in subject.target && context.data === undefined}
      onSubmit={() => {
        request.mutate(values, { onSuccess: onRequested });
      }}
      onReview={review}
    >
      <ForWhom
        user={user}
        value={values.requesterUserId}
        disabled={locked}
        onChange={(requesterUserId) => {
          change({ requesterUserId });
        }}
      />
      <Choice
        label="Version"
        hint={
          values.version === "default"
            ? VERSION_HINT.standard
            : VERSION_HINT.named
        }
        value={values.version}
        disabled={locked}
        autoFocus={user.role !== "owner"}
        onChange={(version) => {
          change({ version: readVersion(version) });
        }}
      >
        {MovieEditionKeySchema.options.map((edition) => (
          <option key={edition} value={edition}>
            {VERSION_COPY[edition]}
          </option>
        ))}
      </Choice>
      {chosen?.reasons.map((reason) => (
        <Note key={reason}>{movieAdmissionReasonV4(reason)}</Note>
      ))}
      <Keeping
        user={user}
        value={values.keeping}
        disabled={locked}
        onChange={(keeping) => {
          change({ keeping });
        }}
      />
      <LanguagePicker
        value={values.languages}
        disabled={locked}
        onChange={(languages) => {
          change({ languages });
        }}
      />
    </RequestForm>
  );
}

function TelevisionRequest({
  user,
  subject,
  onRequested,
}: FormProps<Exclude<SheetSubject, { kind: "movie" }>>) {
  const { values, change } = useSheetValues(subject, user);
  const { request, locked, review } = useTelevisionRequest(user, subject);
  if (request.data !== undefined) {
    return <Requested subject={subject} outcome={request.data} />;
  }
  // The sheet's first control takes focus: who it is for, for the owner.
  const member = user.role !== "owner";
  const choosesSeasons =
    subject.kind === "series" && subject.seasons.length > 0;
  return (
    <RequestForm
      user={user}
      problem={validationMessage(subject, values)}
      error={request.error}
      pending={request.isPending}
      blocked={false}
      onSubmit={() => {
        request.mutate(values, { onSuccess: onRequested });
      }}
      onReview={review}
    >
      <ForWhom
        user={user}
        value={values.requesterUserId}
        disabled={locked}
        onChange={(requesterUserId) => {
          change({ requesterUserId });
        }}
      />
      {subject.kind === "series" && (
        <Seasons
          subject={subject}
          values={values}
          disabled={locked}
          autoFocus={member}
          change={change}
        />
      )}
      <Keeping
        user={user}
        value={values.keeping}
        disabled={locked}
        onChange={(keeping) => {
          change({ keeping });
        }}
      />
      <LanguagePicker
        value={values.languages}
        disabled={locked}
        autoFocus={member && !choosesSeasons}
        onChange={(languages) => {
          change({ languages });
        }}
      />
      {subject.kind === "series" && values.scope === "series" && (
        <Episodes values={values} disabled={locked} change={change} />
      )}
    </RequestForm>
  );
}

/**
 * The one place a title is asked for: who it is for, which version or which
 * seasons, how long to keep it, and the subtitle languages.
 *
 * It is open for as long as it is rendered:
 *
 *     {asking && (
 *       <RequestSheet
 *         user={user}
 *         subject={{ kind: "movie", title, target: { externalId } }}
 *         onClose={() => setAsking(false)}
 *       />
 *     )}
 *
 * It sends through the same commands, with the same retry keys, as every
 * other write: a title the household does not have yet joins the library
 * first.
 */
export function RequestSheet({ user, subject, onClose, onRequested }: Props) {
  const requested = (outcome: { mediaId: string }) => {
    onRequested?.(outcome);
  };
  return (
    <Sheet title={`Request ${subject.title}`} onClose={onClose}>
      {subject.kind === "movie" ? (
        <MovieRequest user={user} subject={subject} onRequested={requested} />
      ) : (
        <TelevisionRequest
          user={user}
          subject={subject}
          onRequested={requested}
        />
      )}
    </Sheet>
  );
}
