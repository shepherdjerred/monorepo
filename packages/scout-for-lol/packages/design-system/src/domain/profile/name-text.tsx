import { cn } from "#src/lib/cn.ts";

export type NameTextProps = {
  /** The full name of a person or champion. */
  children: string;
  className?: string;
};

/**
 * A name in a row: one line, cut with an ellipsis when the row is too narrow,
 * so every row keeps one height. The whole name stays in the document as text
 * and in `title`, so assistive technology and a hover still get it.
 *
 * It is a block so it can shrink inside a flex or grid row; give the row a
 * track that can shrink (`minmax(0, 1fr)`, or `flex: 1; min-width: 0`).
 */
export function NameText({ children, className }: NameTextProps) {
  return (
    <span className={cn("scout-name", className)} title={children}>
      {children}
    </span>
  );
}
