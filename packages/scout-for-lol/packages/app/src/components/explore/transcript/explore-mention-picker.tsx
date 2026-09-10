import type { ExploreMentionCandidate } from "@scout-for-lol/data";

/**
 * The list a reader picks a mention from.
 *
 * Anchored to the composer rather than to the caret. Caret-anchored would be
 * closer to a code editor, but it needs mirrored-div measurement to place, and
 * an auto-growing textarea moves the caret's coordinates on every keystroke —
 * so it buys jitter in exchange for precision nobody reads a chat box for.
 *
 * Deliberately not a Radix `Popover`: that moves focus to the surface it
 * opens, and this must leave the caret in the textarea so the reader can keep
 * typing to narrow the list. Focus stays put and the textarea carries the
 * combobox ARIA instead, with `aria-activedescendant` pointing at the
 * highlighted row.
 */
export function ExploreMentionPicker(props: {
  readonly id: string;
  readonly candidates: ExploreMentionCandidate[];
  readonly activeIndex: number;
  readonly loading: boolean;
  readonly optionId: (index: number) => string;
  readonly onSelect: (candidate: ExploreMentionCandidate) => void;
}) {
  if (props.candidates.length === 0 && !props.loading) {
    return null;
  }
  return (
    <ul
      id={props.id}
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full overflow-y-auto rounded-lg border border-scout-border bg-scout-surface py-1 shadow-lg"
    >
      {props.candidates.map((candidate, index) => (
        <li
          key={`${candidate.kind}-${candidate.insertText}`}
          id={props.optionId(index)}
          role="option"
          aria-selected={index === props.activeIndex}
          className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-sm ${
            index === props.activeIndex ? "bg-scout-hover" : ""
          }`}
          // Pointer-down rather than click: a click fires after the textarea
          // has already blurred, which closes the list out from under it.
          onPointerDown={(event) => {
            event.preventDefault();
            props.onSelect(candidate);
          }}
        >
          <span className="truncate">{candidate.label}</span>
          {candidate.detail !== null && (
            <span className="shrink-0 text-xs text-scout-subtle">
              {candidate.detail}
            </span>
          )}
        </li>
      ))}
      {props.loading && props.candidates.length === 0 && (
        <li className="px-3 py-1.5 text-sm text-scout-subtle">Searching…</li>
      )}
    </ul>
  );
}
