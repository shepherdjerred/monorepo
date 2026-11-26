import { Button } from "@shepherdjerred/console-ui/components/button.tsx";
import {
  Dialog,
  DialogClose,
} from "@shepherdjerred/console-ui/components/dialog.tsx";
import { KeyHint } from "@shepherdjerred/console-ui/components/keyboard/key-hint.tsx";
import type { ShortcutRegistry } from "@shepherdjerred/console-ui/components/keyboard/shortcut-registry.ts";

export type ShortcutSheetProps = {
  readonly registry: ShortcutRegistry;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title?: string;
};

/**
 * The keyboard help: every shortcut in an active scope, by group, read from
 * the same registry the key handler uses. Register a `?` shortcut that opens
 * it; its own row then appears in the list.
 */
export function ShortcutSheet({
  registry,
  open,
  onOpenChange,
  title = "Keyboard shortcuts",
}: ShortcutSheetProps): React.JSX.Element {
  const groups = registry.useSheet();
  return (
    <Dialog
      title={title}
      size="md"
      open={open}
      onOpenChange={onOpenChange}
      actions={<DialogClose render={<Button />}>Close</DialogClose>}
    >
      <div className="ui-shortcuts">
        {groups.map(({ group, shortcuts }) => (
          <section key={group} className="ui-shortcuts-group">
            <h3 className="ui-shortcuts-heading">{group}</h3>
            <dl className="ui-shortcuts-list">
              {shortcuts.map((shortcut) => (
                <div key={shortcut.id} className="ui-shortcuts-row">
                  <dt>{shortcut.description}</dt>
                  <dd>
                    <KeyHint keys={shortcut.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
