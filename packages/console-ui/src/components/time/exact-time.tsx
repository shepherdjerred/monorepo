import {
  formatExact,
  toIso,
  type ExactOptions,
  type TimeInput,
} from "@shepherdjerred/console-ui/format/format.ts";

export type ExactTimeProps = ExactOptions & {
  readonly value: TimeInput;
};

/** The exact moment in Pacific time: "Nov 26, 14:02 PT". */
export function ExactTime({
  value,
  precision,
  year,
}: ExactTimeProps): React.JSX.Element {
  return (
    <time className="ui-time ui-mono" dateTime={toIso(value)}>
      {formatExact(value, {
        ...(precision === undefined ? {} : { precision }),
        ...(year === undefined ? {} : { year }),
      })}
    </time>
  );
}
