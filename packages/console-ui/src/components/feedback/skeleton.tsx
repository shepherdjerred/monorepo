export type SkeletonProps =
  | { readonly kind: "line"; readonly lines?: number }
  | { readonly kind: "block"; readonly height?: "sm" | "md" | "lg" }
  | {
      readonly kind: "rows";
      readonly rows?: number;
      readonly columns?: number;
    };

/**
 * Placeholder bones for content that is loading. Decorative: the page also
 * renders a `State kind="loading"` line (or sets `aria-busy`) for assistive
 * tech. The shimmer stops under reduced motion.
 */
export function Skeleton(props: SkeletonProps): React.JSX.Element {
  if (props.kind === "line") {
    const count = props.lines ?? 3;
    return (
      <div className="ui-skeleton" data-kind="line" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <span
            key={index}
            className="ui-bone"
            data-last={index === count - 1 && count > 1 ? "" : undefined}
          />
        ))}
      </div>
    );
  }
  if (props.kind === "block") {
    return (
      <div className="ui-skeleton" data-kind="block" aria-hidden="true">
        <span className="ui-bone" data-height={props.height ?? "md"} />
      </div>
    );
  }
  const rows = props.rows ?? 5;
  const columns = props.columns ?? 4;
  return (
    <div className="ui-skeleton" data-kind="rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="ui-skeleton-row"
          style={{
            gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: columns }, (_column, column) => (
            <span key={column} className="ui-bone" />
          ))}
        </div>
      ))}
    </div>
  );
}
