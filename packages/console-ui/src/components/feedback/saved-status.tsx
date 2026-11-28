export type SavedStatusProps = {
  /** Show the line; it stays in the DOM so the live region is announced. */
  readonly saved: boolean;
  readonly children?: string;
};

/**
 * A polite live "Saved." line. It is visible while `saved` is true, then
 * fades out; the text stays for screen readers, so the announcement is made
 * once when the state flips.
 */
export function SavedStatus({
  saved,
  children = "Saved.",
}: SavedStatusProps): React.JSX.Element {
  return (
    <p
      className="ui-saved"
      role="status"
      aria-live="polite"
      data-visible={saved ? "" : undefined}
    >
      {saved ? children : ""}
    </p>
  );
}
