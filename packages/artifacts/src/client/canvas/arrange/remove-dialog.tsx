import { Dialog } from "#client/shell/dialog.tsx";

/** Confirms removing frames from the board; the artifacts themselves are never deleted. */
export function RemoveDialog({
  titles,
  open,
  onClose,
  onConfirm,
}: {
  readonly titles: readonly string[];
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  return (
    <Dialog
      open={open}
      title={
        titles.length === 1
          ? `Remove “${titles[0] ?? ""}” from the board?`
          : `Remove ${String(titles.length)} frames from the board?`
      }
      onClose={onClose}
    >
      <p>
        It leaves this board only. The artifact, its versions and its threads
        are kept, and Ctrl or ⌘ Z brings it back.
      </p>
      <div className="ar-dialog-actions">
        <button type="button" className="ui-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="ui-btn"
          data-variant="primary"
          data-testid="confirm-remove"
          onClick={onConfirm}
        >
          Remove from board
        </button>
      </div>
    </Dialog>
  );
}
