import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import {
  isRecoveryScopeV2,
  respondentMediaIds,
  type RecoveryDetail,
} from "#shared/recovery.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { queryClient, writeApi } from "#client/api.ts";
import {
  DECLARATION_COPY,
  isWaitingState,
} from "#client/presentation/recovery.ts";
import { Button, ButtonRow } from "#client/ui/button.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, Callout } from "#client/ui/feedback.tsx";
import {
  CheckboxField,
  ChoiceField,
  SelectField,
} from "#client/ui/forms/field.tsx";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";
import { Panel } from "#client/ui/panel.tsx";
import { Before, Plain } from "./parts.tsx";
import styles from "./recovery.module.css";

const cx = classNames(styles);

const INTENTS = [
  "request",
  "keep",
  "no_longer_request",
] as const satisfies readonly (keyof typeof DECLARATION_COPY)[];
/** More titles than this are answered with one select each. */
const COMPACT_FROM = 8;
type Intent = (typeof INTENTS)[number];
type Choices = Readonly<Record<string, Intent>>;
type Media = RecoveryDetail["scope"]["media"][number];

function intentOf(value: string): Intent {
  const found = INTENTS.find((intent) => intent === value);
  if (found === undefined) throw new Error(`Unknown declaration ${value}`);
  return found;
}

/** One declaration form for each person this reader may declare for. */
export function DeclarationPanels({
  user,
  review,
}: {
  user: MediaUser;
  review: RecoveryDetail;
}) {
  const subjects = review.scope.users.filter(
    (person) =>
      person.id === user.id ||
      (user.role === "owner" &&
        !user.restricted &&
        "declarationAuthority" in person &&
        person.declarationAuthority === "managed_owner"),
  );
  return (
    <>
      {subjects.map((subject) => (
        <SubjectDeclaration
          key={`${review.id}:${subject.id}`}
          user={user}
          review={review}
          subjectId={subject.id}
        />
      ))}
    </>
  );
}

/** What the declaration covers, said before anything is chosen. */
function Scope({
  proxyName,
  titles,
  records,
}: {
  /** The managed profile the owner declares for, when it is not themselves. */
  proxyName: string | null;
  titles: number;
  records: number;
}) {
  return (
    <>
      {proxyName !== null && (
        <p>
          You are declaring as the owner for this exact managed Plex profile.
          The record keeps you as the actor and {proxyName} as the requester.
          Independent accounts must respond themselves.
        </p>
      )}
      <p>
        This declaration covers only the {titles} listed{" "}
        {titles === 1 ? "title" : "titles"}. Other episodes, series
        subscriptions and existing pins remain unchanged.
      </p>
      {records > 0 && (
        <p>
          {records} exact legacy request records are associated with this person
          and these titles. Your declaration accounts for this selected scope
          only; unselected history remains protected.
        </p>
      )}
    </>
  );
}

function SubjectDeclaration({
  user,
  review,
  subjectId,
}: {
  user: MediaUser;
  review: RecoveryDetail;
  subjectId: string;
}) {
  const headingId = useId();
  const subject = review.scope.users.find((person) => person.id === subjectId);
  const applicable = respondentMediaIds(review.scope, subjectId);
  const selectedMedia = review.scope.media.filter((item) =>
    applicable.includes(item.id),
  );
  const proxy = subjectId !== user.id;
  const acknowledgements = isRecoveryScopeV2(review.scope)
    ? (review.scope.users.find((person) => person.id === subjectId)
        ?.claimAcknowledgements ?? [])
    : [];
  return (
    <Panel
      title={
        proxy
          ? `Declare for ${subject?.displayName ?? "managed profile"}`
          : "Your present intent"
      }
      titleId={headingId}
      description={
        <Scope
          proxyName={proxy ? (subject?.displayName ?? null) : null}
          titles={selectedMedia.length}
          records={acknowledgements.length}
        />
      }
    >
      <DeclarationBody
        user={user}
        review={review}
        subjectId={subjectId}
        headingId={headingId}
        media={selectedMedia}
        acknowledgements={acknowledgements}
        proxy={proxy}
      />
    </Panel>
  );
}

/** Whichever of the declaration, its record, or the reason it cannot be made applies. */
function DeclarationBody(props: {
  user: MediaUser;
  review: RecoveryDetail;
  subjectId: string;
  headingId: string;
  media: readonly Media[];
  acknowledgements: readonly unknown[];
  proxy: boolean;
}) {
  const { review, subjectId, media } = props;
  const previous = review.responses.find((row) => row.userId === subjectId);
  if (previous !== undefined) {
    return (
      <Recorded review={review} declarations={previous.response.declarations} />
    );
  }
  if (!isWaitingState(review.state)) {
    return (
      <Callout tone="warn" title="This review has been applied">
        It can no longer take declarations.
      </Callout>
    );
  }
  if (review.scope.blockers.length > 0) {
    return (
      <Callout tone="warn" title="This review cannot take declarations yet">
        It has a blocker, listed above. The owner must resolve it and prepare a
        new review.
      </Callout>
    );
  }
  return media.length === 0 ? (
    <Plain>No title in this review applies to this person.</Plain>
  ) : (
    <DeclarationForm {...props} />
  );
}

/** A declaration already made: immutable, and what it said. */
function Recorded({
  review,
  declarations,
}: {
  review: RecoveryDetail;
  declarations: readonly { mediaId: string; intent: Intent }[];
}) {
  const applied = review.state === "released";
  return (
    <>
      <Callout
        tone={applied ? "ok" : "neutral"}
        title={
          applied
            ? "This declaration was applied"
            : "This declaration is recorded and waiting for the owner"
        }
      >
        It is immutable. To change it, ask the owner to prepare a new review.
      </Callout>
      <DataList label="What was declared">
        {declarations.map((declaration) => (
          <DataRow
            key={declaration.mediaId}
            title={
              review.scope.media.find(
                (media) => media.id === declaration.mediaId,
              )?.title
            }
            status={
              <Badge tone="neutral">
                {DECLARATION_COPY[declaration.intent].option}
              </Badge>
            }
          />
        ))}
      </DataList>
    </>
  );
}

/** What the choices so far add up to, in one sentence. */
function summarize(media: readonly Media[], choices: Choices): string {
  const undecided = media.filter((item) => choices[item.id] === undefined);
  if (undecided.length > 0) {
    return `${String(undecided.length)} of ${String(media.length)} titles still need an answer. `;
  }
  const tally = INTENTS.map((intent) => ({
    intent,
    count: media.filter((item) => choices[item.id] === intent).length,
  }))
    .filter((row) => row.count > 0)
    .map(
      (row) =>
        `${String(row.count)} ${DECLARATION_COPY[row.intent].option.toLocaleLowerCase()}`,
    );
  return `You are recording ${tally.join(", ")}. `;
}

function DeclarationForm({
  user,
  review,
  subjectId,
  headingId,
  media,
  acknowledgements,
  proxy,
}: {
  user: MediaUser;
  review: RecoveryDetail;
  subjectId: string;
  headingId: string;
  media: readonly Media[];
  acknowledgements: readonly unknown[];
  proxy: boolean;
}) {
  const [choices, setChoices] = useState<Choices>({});
  const submit = useMutation({
    mutationFn: () =>
      writeApi({
        actorId: user.id,
        path: `/recovery/reviews/${review.id}/responses`,
        schema: CommandResultSchema,
        body: {
          scopeHash: review.scopeHash,
          ...(isRecoveryScopeV2(review.scope)
            ? {
                subjectUserId: subjectId,
                claimAcknowledgements: acknowledgements,
              }
            : {}),
          acknowledgePending: true,
          declarations: media.map((item) => {
            const intent = choices[item.id];
            if (intent === undefined)
              throw new Error(`No declaration was chosen for ${item.title}`);
            return {
              mediaId: item.id,
              intent,
              ...(intent === "keep" ? { days: 30 } : {}),
            };
          }),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recovery"] });
    },
  });
  return (
    <Form
      labelledBy={headingId}
      onSubmit={() => {
        submit.mutate();
      }}
    >
      {media.length > 3 && (
        <div className={cx("bulk")}>
          <p className={cx("count")}>
            Answer every title the same way, then change the ones that differ.
          </p>
          <ButtonRow>
            {INTENTS.map((intent) => (
              <Button
                key={intent}
                onClick={() => {
                  setChoices(
                    Object.fromEntries(media.map((item) => [item.id, intent])),
                  );
                }}
              >
                Set all to &ldquo;{DECLARATION_COPY[intent].option}&rdquo;
              </Button>
            ))}
          </ButtonRow>
        </div>
      )}
      <ul className={cx("decisions")}>
        {media.map((item) => (
          <li key={item.id}>
            <Decision
              media={item}
              compact={media.length > COMPACT_FROM}
              chosen={choices[item.id]}
              onChoose={(intent) => {
                setChoices({ ...choices, [item.id]: intent });
              }}
            />
          </li>
        ))}
      </ul>
      <CheckboxField
        name="pending"
        required
        requiredMessage="Confirm you understand the declaration is pending."
        label="I understand these declarations are pending, and do not replace an immediate Keep action. I reviewed the associated legacy records for this exact selected scope."
      />
      <Before>
        {summarize(media, choices)}
        The declaration is immutable and stays pending until the owner applies
        the review; nothing about requests or Keep changes before then.
      </Before>
      <FormFooter
        submitLabel={
          proxy ? "Record managed-profile declaration" : "Record my declaration"
        }
        pendingLabel="Recording declaration"
        pending={submit.isPending}
        error={submit.error}
      />
    </Form>
  );
}

function Decision({
  media,
  compact,
  chosen,
  onChoose,
}: {
  media: Media;
  /** A long list: one select a line instead of three radios. */
  compact: boolean;
  chosen: Intent | undefined;
  onChoose: (intent: Intent) => void;
}) {
  if (compact) {
    return (
      <SelectField
        label={media.title}
        name={`declaration-${media.id}`}
        required
        requiredMessage={`Choose what you want for ${media.title}.`}
        value={chosen ?? ""}
        width="medium"
        onChange={(event) => {
          onChoose(intentOf(event.target.value));
        }}
        {...(chosen === undefined
          ? {}
          : { description: DECLARATION_COPY[chosen].consequence })}
      >
        <option value="" disabled>
          Choose
        </option>
        {INTENTS.map((intent) => (
          <option key={intent} value={intent}>
            {DECLARATION_COPY[intent].option}
          </option>
        ))}
      </SelectField>
    );
  }
  return (
    <ChoiceField
      legend={media.title}
      name={`declaration-${media.id}`}
      required
      requiredMessage={`Choose what you want for ${media.title}.`}
      value={chosen ?? ""}
      onChange={(value) => {
        onChoose(intentOf(value));
      }}
      options={INTENTS.map((intent) => ({
        value: intent,
        label: DECLARATION_COPY[intent].option,
      }))}
      {...(chosen === undefined
        ? {}
        : { description: DECLARATION_COPY[chosen].consequence })}
    />
  );
}
