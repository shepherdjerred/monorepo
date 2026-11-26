import { Fragment } from "react";

/**
 * A package, task or path name that may wrap only after a `/` or `#`, so
 * `@shepherdjerred/alert-dashboard` breaks at the slash and never inside a
 * word or at a hyphen. Each segment is a no-wrap `.id-seg`; the `<wbr>`
 * between segments is the only break opportunity.
 */
export function Identifier({
  value,
}: {
  readonly value: string;
}): React.JSX.Element {
  const segments: { readonly text: string; readonly offset: number }[] = [];
  let offset = 0;
  for (const text of value.split(/(?<=[/#])/u)) {
    segments.push({ text, offset });
    offset += text.length;
  }
  return (
    <>
      {segments.map((segment) => (
        <Fragment key={segment.offset}>
          {segment.offset === 0 ? null : <wbr />}
          <span className="id-seg">{segment.text}</span>
        </Fragment>
      ))}
    </>
  );
}
