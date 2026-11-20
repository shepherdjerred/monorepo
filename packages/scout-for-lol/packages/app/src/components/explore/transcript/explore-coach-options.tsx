import type { CoachOption, ExploreMessage } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";

/**
 * The options of a multiple-choice coach answer: two to four labeled choices,
 * each with the one line that argues for it.
 *
 * They are offered, never commanded, so picking one is a question back to the
 * coach ("Tell me more about Ornn"), not a decision the page records. With no
 * handler (a shared or read-only transcript) they read as a plain list.
 */
export function ExploreCoachOptions(props: {
  readonly options: readonly CoachOption[];
  readonly onChoose?: ((question: string) => void) | undefined;
}) {
  const { options, onChoose } = props;
  return (
    <ul aria-label="Options" className="m-0 flex list-none flex-col gap-2 p-0">
      {options.map((option) => (
        <li key={option.label}>
          {onChoose === undefined ? (
            <div className="rounded-md border border-border px-3 py-2">
              <div className="font-medium">{option.label}</div>
              <div className="text-sm text-muted-foreground">
                {option.rationale}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="w-full cursor-pointer rounded-md border border-border px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => {
                onChoose(`Tell me more about ${option.label}`);
              }}
            >
              <span className="block font-medium">{option.label}</span>
              <span className="block text-sm text-muted-foreground">
                {option.rationale}
              </span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * What an answer offers the reader to do next: its coach options, then its
 * suggested follow-up questions. Both are sent as the next turn, so both go
 * once a new turn starts or when nothing can send one.
 */
export function AssistantTurnChoices(props: {
  readonly message: Pick<ExploreMessage, "coachOptions" | "followUps">;
  readonly onFollowUp?: ((question: string) => void) | undefined;
}) {
  const { message, onFollowUp } = props;
  return (
    <>
      {message.coachOptions !== null && (
        <ExploreCoachOptions
          options={message.coachOptions}
          onChoose={onFollowUp}
        />
      )}
      {onFollowUp !== undefined && message.followUps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {message.followUps.map((followUp) => (
            <Button
              key={followUp}
              variant="outline"
              size="sm"
              onClick={() => {
                onFollowUp(followUp);
              }}
            >
              {followUp}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
