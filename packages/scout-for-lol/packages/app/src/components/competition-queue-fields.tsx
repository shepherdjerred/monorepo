import {
  competitionQueueTypeToString,
  isCompetitionQueueCurrentlyAvailable,
  type CompetitionQueueType,
} from "@scout-for-lol/data";
import { FieldError } from "@scout-for-lol/design-system/components/input";

export function CompetitionQueueFields(props: {
  name: string;
  value: CompetitionQueueType[];
  options: readonly CompetitionQueueType[];
  error: string | undefined;
  onBlur: () => void;
  onChange: (queues: CompetitionQueueType[]) => void;
}) {
  return (
    <fieldset
      className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
      aria-invalid={props.error === undefined ? undefined : true}
      aria-describedby={
        props.error === undefined ? undefined : "criteria-queues-error"
      }
    >
      <legend className="px-1 text-sm font-medium text-scout-ink">
        Queues
      </legend>
      {props.options.map((queue) => {
        const checked = props.value.includes(queue);
        const available = isCompetitionQueueCurrentlyAvailable(queue);
        return (
          <label
            key={queue}
            className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-scout-hover"
          >
            <input
              type="checkbox"
              name={props.name}
              value={queue}
              className="mt-0.5 size-5 shrink-0"
              checked={checked}
              onBlur={props.onBlur}
              onChange={(event) => {
                if (event.currentTarget.checked) {
                  props.onChange(
                    queue === "ALL"
                      ? ["ALL"]
                      : [
                          ...props.value.filter((entry) => entry !== "ALL"),
                          queue,
                        ],
                  );
                  return;
                }
                const next = props.value.filter((entry) => entry !== queue);
                if (next.length > 0) props.onChange(next);
              }}
            />
            <span className="flex flex-col text-sm text-scout-ink">
              <span>{competitionQueueTypeToString(queue)}</span>
              {available ? null : (
                <span className="text-xs text-scout-subtle">
                  Limited-time mode — not currently live
                </span>
              )}
            </span>
          </label>
        );
      })}
      {props.error === undefined ? null : (
        <FieldError id="criteria-queues-error">{props.error}</FieldError>
      )}
    </fieldset>
  );
}
