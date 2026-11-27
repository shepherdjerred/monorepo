import { ChevronDown } from "lucide-react";
import {
  forwardRef,
  useState,
  type DetailsHTMLAttributes,
  type ReactNode,
  type ToggleEvent,
} from "react";
import { cn } from "#src/lib/cn.ts";

export type FoldProps = Omit<
  DetailsHTMLAttributes<HTMLDetailsElement>,
  "children"
> & {
  /** The always-visible label. It is the disclosure's accessible name. */
  summary: ReactNode;
  /** Whether the fold starts open when it is not controlled through `open`. */
  defaultOpen?: boolean;
  children: ReactNode;
};

/**
 * A disclosure that is closed by default and opens in place. It is the
 * platform `<details>`/`<summary>` pair, so keyboard, find-in-page and
 * assistive-technology behaviour is native.
 */
export const Fold = forwardRef<HTMLDetailsElement, FoldProps>(
  (
    {
      children,
      className,
      defaultOpen = false,
      onToggle,
      open,
      summary,
      ...props
    },
    ref,
  ) => {
    const [openState, setOpenState] = useState(defaultOpen);
    const handleToggle = (event: ToggleEvent<HTMLDetailsElement>): void => {
      setOpenState(event.currentTarget.open);
      onToggle?.(event);
    };
    return (
      <details
        {...props}
        ref={ref}
        className={cn("scout-fold", className)}
        open={open ?? openState}
        onToggle={handleToggle}
      >
        <summary className="scout-fold__summary">
          <span>{summary}</span>
          <ChevronDown
            className="scout-fold__chevron"
            size={18}
            aria-hidden="true"
          />
        </summary>
        <div className="scout-fold__body">{children}</div>
      </details>
    );
  },
);
Fold.displayName = "Fold";
