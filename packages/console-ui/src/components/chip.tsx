import type { ReactNode } from "react";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

type ChipContent =
  | {
      /** A tag: a category or short label, e.g. a link's source. */
      readonly children: ReactNode;
      readonly label?: never;
      readonly value?: never;
    }
  | {
      /** A key metric: muted label, mono value. */
      readonly label: string;
      readonly value: string | number;
      readonly children?: never;
    };

export type ChipProps = ChipContent & {
  /** Colours the value (or a tag's text); the words must still carry the meaning. */
  readonly severity?: Severity;
  /** Makes the chip a link. */
  readonly href?: string;
  readonly title?: string;
};

/**
 * A 22px bordered chip: a tag (`children`) or a label/value pair. Chips
 * carry no margin; put them in a `.ui-chips` row or any gap container.
 */
export function Chip(props: ChipProps): React.JSX.Element {
  const { severity, href, title } = props;
  const content =
    props.children === undefined ? (
      <>
        {props.label}
        <b className="ui-chip-value">{props.value}</b>
      </>
    ) : (
      props.children
    );
  const kind = props.children === undefined ? "metric" : "tag";
  return href === undefined ? (
    <span
      className="ui-chip"
      data-kind={kind}
      data-sev={severity}
      title={title}
    >
      {content}
    </span>
  ) : (
    <a
      className="ui-chip"
      data-kind={kind}
      data-sev={severity}
      title={title}
      href={href}
    >
      {content}
    </a>
  );
}
