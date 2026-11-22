import { useId, useState } from "react";
import type { MediaUser } from "#shared/contract.ts";
import { dateLabel } from "#client/components.tsx";
import { Plain, TextLink, Before } from "#client/recovery/parts.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Callout } from "#client/ui/feedback.tsx";
import {
  CheckboxField,
  ChoiceField,
  SelectField,
} from "#client/ui/forms/field.tsx";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";
import { Panel } from "#client/ui/panel.tsx";
import type { MovieHistoryWriteControllerV3 } from "./api.ts";
import {
  movieHistoryCurrentChoiceV3,
  movieHistoryResponseV3,
  type MovieHistoryDeclarationContextV3,
} from "./declaration.ts";
import { INTENT_COPY, intentOf, type Intent } from "./intents.ts";
import styles from "./movie-history.module.css";

const cx = classNames(styles);

type Person = MovieHistoryDeclarationContextV3;

/** What the review holds for this person, said before they choose. */
function DeclarationContext({ person }: { person: Person }) {
  const choice = movieHistoryCurrentChoiceV3(person);
  const activeRequest = person.requests.some(
    (row) => row.active && !row.excluded,
  );
  return (
    <>
      {choice === null ? (
        <Plain>
          No explicit current choice for this edition was captured. To request
          it, choose the edition on the movie page and ask the owner for a fresh
          review.
        </Plain>
      ) : (
        <Plain>
          This review contains your explicit edition choice and{" "}
          {choice.subtitleLanguages.length === 0
            ? "no requested caption languages"
            : `requested captions: ${choice.subtitleLanguages.join(", ")}`}
          .
        </Plain>
      )}
      {activeRequest && (
        <Plain>
          To declare that you no longer request this edition, cancel the actual
          request first and ask the owner to capture a fresh review. This form
          cannot cancel a request.
        </Plain>
      )}
      <Plain>
        <TextLink to={`/media/${encodeURIComponent(person.scope.mediaId)}`}>
          Review this movie’s edition choices and Keep
        </TextLink>
      </Plain>
    </>
  );
}

/** Each option, what it records, and why one is not open. */
function intentOptions(person: Person) {
  const choice = movieHistoryCurrentChoiceV3(person);
  const keeps = person.personalHolds.filter(
    (hold) =>
      hold.isPin ||
      (hold.until !== null && Date.parse(hold.until) > Date.now()),
  );
  const activeRequest = person.requests.some(
    (row) => row.active && !row.excluded,
  );
  const options = [
    {
      value: "request",
      blocked:
        choice === null ? "No choice for this edition was captured." : null,
    },
    {
      value: "keep",
      blocked:
        choice === null
          ? "No choice for this edition was captured."
          : keeps.length === 0
            ? "No Keep or pin was captured for this edition."
            : null,
    },
    {
      value: "no_longer_request",
      blocked: activeRequest
        ? "An active request is still captured; cancel it first."
        : null,
    },
  ] as const;
  return {
    keeps,
    options: options.map((option) => ({
      value: option.value,
      label: INTENT_COPY[option.value].option,
      description:
        option.blocked === null
          ? INTENT_COPY[option.value].consequence
          : `Not available: ${option.blocked}`,
      disabled: option.blocked !== null,
    })),
  };
}

/** A declaration already recorded: what it was, and that it cannot be changed. */
function RecordedDeclaration({ person }: { person: Person }) {
  const response = person.response;
  if (response === null) throw new Error("No declaration has been recorded");
  return (
    <Callout
      tone="ok"
      title={`Recorded: ${INTENT_COPY[response.declaration.intent].option}`}
    >
      This declaration is immutable; a change needs a fresh review.
    </Callout>
  );
}

function DeclarationForm({
  user,
  person,
  command,
  headingId,
}: {
  user: MediaUser;
  person: Person;
  command: MovieHistoryWriteControllerV3;
  headingId: string;
}) {
  const [intent, setIntent] = useState<Intent | "">("");
  const [keepId, setKeepId] = useState("");
  const [problem, setProblem] = useState<Error | null>(null);
  const proxy = person.subject.id !== user.id;
  const name = proxy ? `${person.subject.displayName}’s` : "my";
  const { keeps, options } = intentOptions(person);
  const claims = person.subject.claimAcknowledgements.length;
  return (
    <Form
      labelledBy={headingId}
      onEdit={() => {
        setProblem(null);
      }}
      onSubmit={() => {
        if (intent === "") return;
        try {
          const body = movieHistoryResponseV3(person, intent, keepId);
          setProblem(null);
          command.submit({
            actorId: user.id,
            path: `/movie-history/reviews/${encodeURIComponent(person.id)}/responses`,
            body,
          });
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          setProblem(error);
        }
      }}
    >
      <fieldset disabled={command.blocked} className={cx("group")}>
        <ChoiceField
          legend={
            proxy
              ? `${person.subject.displayName}’s present intent`
              : "Your present intent for this edition"
          }
          name="intent"
          layout="stack"
          required
          requiredMessage="Choose what is declared for this edition."
          value={intent}
          onChange={(value) => {
            setIntent(intentOf(value));
            setKeepId("");
          }}
          options={options}
        />
        {intent === "keep" && (
          <SelectField
            label="Captured Keep or pin"
            name="keep"
            required
            requiredMessage="Choose which captured Keep or pin this declaration uses."
            value={keepId}
            onChange={(event) => {
              setKeepId(event.target.value);
            }}
          >
            <option value="">Choose your captured hold</option>
            {keeps.map((hold) => (
              <option key={hold.id} value={hold.id}>
                {hold.isPin ? "Pinned" : `Keep until ${dateLabel(hold.until)}`}
              </option>
            ))}
          </SelectField>
        )}
        <CheckboxField
          name="acknowledge"
          required
          requiredMessage="Confirm the declaration to record it."
          label={`I declare the visible edition and captured choice, acknowledge ${String(claims)} selected imported request claim${claims === 1 ? "" : "s"}, and understand that lost request history cannot be reconstructed from files.`}
        />
        <Before>
          {intent === ""
            ? "Choose a declaration. "
            : `You are recording: ${INTENT_COPY[intent].option}. `}
          It is immutable; a change needs a fresh review, and it creates no
          request or Keep of its own.
        </Before>
        <FormFooter
          submitLabel={`Record ${name} declaration`}
          pendingLabel="Recording declaration"
          pending={command.isPending}
          error={problem}
        />
      </fieldset>
    </Form>
  );
}

/** Which of a declaration, its record, or the reason it cannot be made applies. */
function declarationBody(person: Person, closed: boolean) {
  if (person.response !== null) return "recorded";
  return closed ? "closed" : "open";
}

/**
 * One person's declaration for the cut: what the review captured of their
 * request and Keep, the three things they can declare, and the one they
 * cannot, with the reason.
 */
export function MovieHistoryResponseFormV3({
  user,
  person,
  command,
  closed,
}: {
  user: MediaUser;
  person: Person;
  command: MovieHistoryWriteControllerV3;
  closed: boolean;
}) {
  const headingId = useId();
  const proxy = person.subject.id !== user.id;
  const body = declarationBody(person, closed);
  return (
    <Panel
      title={
        proxy
          ? `Owner declaration for ${person.subject.displayName}`
          : "Your declaration"
      }
      titleId={headingId}
      description={
        proxy
          ? "This is the captured managed Home profile. Independent household members must declare for themselves."
          : undefined
      }
    >
      {body === "recorded" && <RecordedDeclaration person={person} />}
      {body !== "recorded" && <DeclarationContext person={person} />}
      {body === "closed" && (
        <Callout
          tone="warn"
          title="This review can no longer take declarations"
        >
          It is closed or has expired.
        </Callout>
      )}
      {body === "open" && (
        <DeclarationForm
          user={user}
          person={person}
          command={command}
          headingId={headingId}
        />
      )}
    </Panel>
  );
}
