import { useEffect, useRef, useState } from "react";
import { Button } from "@shepherdjerred/console-ui/components/button.tsx";
import { IconButton } from "@shepherdjerred/console-ui/components/icon-button.tsx";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

/** How long "Copied" stays before the button resets. */
export const COPY_RESET_MS = 1800;

type CopyState = "idle" | "copied" | "failed";

export type CopyButtonProps = {
  readonly text: string;
  /** Names the button: "Copy" or "Copy trace id". */
  readonly label?: string;
  /** `icon` is a 28px icon button; `text` shows the label. */
  readonly variant?: "icon" | "text";
};

/**
 * Copies `text` to the clipboard and announces "Copied" or "Copy failed"
 * through a polite live region, then resets after 1.8 seconds.
 */
export function CopyButton({
  text,
  label = "Copy",
  variant = "icon",
}: CopyButtonProps): React.JSX.Element {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const settle = (next: CopyState): void => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState("idle");
    }, COPY_RESET_MS);
  };
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      settle("copied");
    } catch {
      settle("failed");
    }
  };

  const Icon = state === "copied" ? ICONS.copied : ICONS.copy;
  const announcement =
    state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "";
  return (
    <span className="ui-copy" data-state={state}>
      {variant === "icon" ? (
        <IconButton icon={Icon} label={label} onClick={() => void copy()} />
      ) : (
        <Button onClick={() => void copy()}>
          <Icon aria-hidden="true" />
          {state === "copied"
            ? "Copied"
            : state === "failed"
              ? "Copy failed"
              : label}
        </Button>
      )}
      <span className="ui-sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </span>
  );
}
