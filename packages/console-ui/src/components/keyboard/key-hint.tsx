import { Kbd } from "@shepherdjerred/console-ui/components/feedback/kbd.tsx";
import { formatShortcut } from "@shepherdjerred/console-ui/components/keyboard/shortcut-keys.ts";

export type KeyHintProps = {
  /** A shortcut string (`"Mod+K"`, `"g i"`) or keycaps already formatted. */
  readonly keys: string | readonly string[];
  /** Hide from assistive technology when `aria-keyshortcuts` already says it. */
  readonly decorative?: boolean;
};

/**
 * Keycaps for a shortcut: one `Kbd` per key.
 */
export function KeyHint({
  keys,
  decorative = false,
}: KeyHintProps): React.JSX.Element {
  const caps = typeof keys === "string" ? formatShortcut(keys) : keys;
  return (
    <span className="ui-keys" aria-hidden={decorative ? true : undefined}>
      {caps.map((cap, index) => (
        // Keycaps repeat (G G), so their position is their identity.
        <Kbd key={`${String(index)}-${cap}`}>{cap}</Kbd>
      ))}
    </span>
  );
}
