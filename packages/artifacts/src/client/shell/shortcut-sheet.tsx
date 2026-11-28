import { SHORTCUT_SHEET } from "./shortcuts.ts";
import { Dialog } from "./dialog.tsx";

export function ShortcutSheet({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} title="Keyboard shortcuts" onClose={onClose}>
      <dl className="ar-shortcuts">
        {SHORTCUT_SHEET.map((row) => (
          <div key={row.keys}>
            <dt>
              <kbd>{row.keys}</kbd>
            </dt>
            <dd>{row.does}</dd>
          </div>
        ))}
      </dl>
      <div className="ar-dialog-actions">
        <button type="button" className="ui-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
