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
              .filter(
                (shortcut) =>
                  shortcut.group === group && shortcut.sheet !== false,
              )
              .map((shortcut) => {
                const listed =
                  shortcut.sheet === undefined || shortcut.sheet === false
                    ? shortcut
                    : shortcut.sheet;
                return (
                  <div key={shortcut.action}>
                    <dt>{listed.description}</dt>
                    <dd>
                      <kbd>{listed.keys}</kbd>
                    </dd>
                  </div>
                );
              })}
          </dl>
        </section>
      ))}
    </div>
  );
}
