/**
 * The share-link row: a readonly, select-on-focus input plus a one-line ack.
 * The app has no toast; the hint is the acknowledgement.
 */
export function ExploreShareRow(props: { shareLink: string; copied: boolean }) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-xs text-scout-subtle">
        Share link
        <input
          readOnly
          value={props.shareLink}
          onFocus={(event) => {
            event.target.select();
          }}
          className="min-w-0 flex-1 rounded-md border bg-scout-hover px-2 py-1 font-mono text-xs"
        />
      </label>
      <p className="text-xs text-scout-subtle" role="status">
        {props.copied
          ? "Copied to clipboard."
          : "Copy the link manually — clipboard access was unavailable."}
      </p>
    </div>
  );
}
