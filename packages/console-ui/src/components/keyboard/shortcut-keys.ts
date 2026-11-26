/**
 * How a shortcut is written, matched and shown. One string per shortcut:
 *
 * - `"c"`, `"?"`, `"Escape"`: one key, matched against `KeyboardEvent.key`,
 *   so `"P"` is Shift+P and `"?"` is whatever types a question mark.
 * - `"g i"`: a sequence, keys pressed one after another.
 * - `"Mod+K"`, `"Mod+Shift+Enter"`, `"Alt+N"`: a chord. `Mod` is ⌘ on
 *   macOS and Ctrl elsewhere (either is accepted). Letters, digits and
 *   punctuation match the physical key (`code`), so Shift or Alt never
 *   changes which key it is.
 */

export type ShortcutBinding =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "sequence"; readonly keys: readonly string[] }
  | {
      readonly kind: "chord";
      readonly mod: boolean;
      readonly ctrl: boolean;
      readonly alt: boolean;
      readonly shift: boolean;
      /** `code` for printable keys (`KeyK`, `Digit1`, `Comma`), else `key`. */
      readonly key: string;
      readonly by: "code" | "key";
    };

/** The fields of a key press the matcher reads; tests pass plain objects. */
export type ShortcutKeyPress = {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
};

const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  ";": "Semicolon",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "-": "Minus",
  "=": "Equal",
  "`": "Backquote",
  "\\": "Backslash",
};

const MODIFIERS = new Set(["mod", "ctrl", "alt", "shift", "meta"]);

function chordKey(key: string): { key: string; by: "code" | "key" } {
  if (/^[a-z]$/i.test(key))
    return { key: `Key${key.toUpperCase()}`, by: "code" };
  if (/^\d$/.test(key)) return { key: `Digit${key}`, by: "code" };
  const punctuation = PUNCTUATION_CODES[key];
  return punctuation === undefined
    ? { key, by: "key" }
    : { key: punctuation, by: "code" };
}

/** Parses a shortcut string; a malformed one throws, as it is a bug. */
export function parseShortcut(keys: string): ShortcutBinding {
  const trimmed = keys.trim();
  if (trimmed === "") throw new Error("A shortcut needs at least one key.");
  const parts = trimmed.split("+");
  if (trimmed !== "+" && parts.length > 1) {
    const key = parts.at(-1) ?? "";
    const modifiers = new Set(
      parts.slice(0, -1).map((part) => part.toLowerCase()),
    );
    for (const modifier of modifiers) {
      if (!MODIFIERS.has(modifier)) {
        throw new Error(`Unknown modifier "${modifier}" in "${keys}".`);
      }
    }
    if (key === "")
      throw new Error(`"${keys}" has no key after its modifiers.`);
    return {
      kind: "chord",
      mod: modifiers.has("mod") || modifiers.has("meta"),
      ctrl: modifiers.has("ctrl"),
      alt: modifiers.has("alt"),
      shift: modifiers.has("shift"),
      ...chordKey(key),
    };
  }
  const sequence = trimmed.split(/\s+/);
  return sequence.length > 1
    ? { kind: "sequence", keys: sequence }
    : { kind: "key", key: trimmed };
}

/** Whether a key press is this chord. */
export function matchesChord(
  binding: Extract<ShortcutBinding, { kind: "chord" }>,
  press: ShortcutKeyPress,
): boolean {
  const modPressed = press.metaKey || press.ctrlKey;
  const keyOk =
    binding.by === "code"
      ? binding.key === press.code
      : binding.key.toLowerCase() === press.key.toLowerCase();
  const modOk = binding.ctrl
    ? press.ctrlKey
    : binding.mod
      ? modPressed
      : !modPressed;
  return (
    keyOk &&
    modOk &&
    binding.alt === press.altKey &&
    binding.shift === press.shiftKey
  );
}

/** A stable identity for a binding; two shortcuts may not share one in a scope. */
export function bindingId(binding: ShortcutBinding): string {
  switch (binding.kind) {
    case "key": {
      return `key:${binding.key}`;
    }
    case "sequence": {
      return `sequence:${binding.keys.join(" ")}`;
    }
    case "chord": {
      const flags = [
        binding.mod ? "mod" : "",
        binding.ctrl ? "ctrl" : "",
        binding.alt ? "alt" : "",
        binding.shift ? "shift" : "",
      ].filter((flag) => flag !== "");
      return `chord:${[...flags, binding.key].join("+")}`;
    }
  }
}

/** Whether this browser runs on Apple hardware, where Mod is ⌘. */
export function isApplePlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
  );
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  Escape: "Esc",
  Enter: "Enter",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backspace: "⌫",
  Delete: "Del",
  " ": "Space",
};

function keyLabel(key: string): string {
  const named = KEY_NAMES[key];
  if (named !== undefined) return named;
  const code = /^(?:Key|Digit)(.)$/.exec(key);
  if (code?.[1] !== undefined) return code[1];
  const punctuation = Object.entries(PUNCTUATION_CODES).find(
    ([, name]) => name === key,
  );
  return punctuation?.[0] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/**
 * The keys as shown in a hint or the help sheet, one token per keycap:
 * `"Mod+K"` is `["⌘", "K"]` on a Mac and `["Ctrl", "K"]` elsewhere, `"P"`
 * is `["⇧", "P"]` and `"g i"` is `["G", "I"]`.
 */
export function formatShortcut(
  keys: string,
  apple: boolean = isApplePlatform(),
): readonly string[] {
  const binding = parseShortcut(keys);
  switch (binding.kind) {
    case "key": {
      return /^[A-Z]$/.test(binding.key)
        ? ["⇧", binding.key]
        : [keyLabel(binding.key)];
    }
    case "sequence": {
      return binding.keys.map((key) => keyLabel(key));
    }
    case "chord": {
      return chordCaps(binding, apple);
    }
  }
}

function chordCaps(
  binding: Extract<ShortcutBinding, { kind: "chord" }>,
  apple: boolean,
): string[] {
  const names = apple
    ? { ctrl: "⌃", mod: "⌘", alt: "⌥" }
    : { ctrl: "Ctrl", mod: "Ctrl", alt: "Alt" };
  const caps: string[] = [];
  if (binding.ctrl) caps.push(names.ctrl);
  if (binding.mod) caps.push(names.mod);
  if (binding.alt) caps.push(names.alt);
  if (binding.shift) caps.push("⇧");
  caps.push(keyLabel(binding.key));
  return caps;
}

/**
 * The shortcut in `aria-keyshortcuts` form, which screen readers announce
 * in place of a visible hint. Sequences have no such form.
 */
export function ariaKeyshortcuts(keys: string): string | undefined {
  const binding = parseShortcut(keys);
  switch (binding.kind) {
    case "key": {
      return /^[A-Z]$/.test(binding.key) ? `Shift+${binding.key}` : binding.key;
    }
    case "sequence": {
      return undefined;
    }
    case "chord": {
      const key = keyLabel(binding.key);
      const rest = [
        ...(binding.alt ? ["Alt"] : []),
        ...(binding.shift ? ["Shift"] : []),
        key,
      ].join("+");
      if (binding.ctrl) return `Control+${rest}`;
      return binding.mod ? `Meta+${rest} Control+${rest}` : rest;
    }
  }
}
