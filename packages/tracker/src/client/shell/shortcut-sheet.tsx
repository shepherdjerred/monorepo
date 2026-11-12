import { shortcutGroups, shortcuts } from "./shortcuts.ts";

/** The help sheet, generated from the same list the key handler reads. */
export function ShortcutSheet() {
  return (
    <div className="shortcut-sheet">
      {shortcutGroups.map((group) => (
        <section key={group}>
          <h3>{group}</h3>
          <dl className="shortcut-list">
            {shortcuts
              .filter((shortcut) => shortcut.group === group)
              .map((shortcut) => (
                <div key={shortcut.action}>
                  <dt>{shortcut.description}</dt>
                  <dd>
                    <kbd>{shortcut.keys}</kbd>
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
