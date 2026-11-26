export type CodeBlockProps = {
  readonly code: string;
  /** Accessible name of the scrollable region, e.g. "Alert rule YAML". */
  readonly label: string;
  readonly lineNumbers?: boolean;
  /** 1-based line to highlight, e.g. the failing line. */
  readonly activeLine?: number;
  /** Wrap long lines instead of scrolling sideways. */
  readonly wrap?: boolean;
};

/**
 * Mono text in a focusable, scrollable region (keyboard users can scroll
 * it), with optional line numbers and one highlighted line.
 */
export function CodeBlock({
  code,
  label,
  lineNumbers = false,
  activeLine,
  wrap = false,
}: CodeBlockProps): React.JSX.Element {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div
      className="ui-code"
      role="region"
      aria-label={label}
      tabIndex={0}
      data-wrap={wrap ? "" : undefined}
      data-numbers={lineNumbers ? "" : undefined}
    >
      <pre>
        <code>
          {lines.map((line, index) => (
            <span
              // Lines have no identity beyond their position.
              key={index}
              className="ui-code-line"
              data-active={activeLine === index + 1 ? "" : undefined}
              aria-current={activeLine === index + 1 ? "location" : undefined}
            >
              {line}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
