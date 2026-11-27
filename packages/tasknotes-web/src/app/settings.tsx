import type { ReactNode } from "react";
import { z } from "zod";
import type { Preferences } from "./preferences.ts";

const ThemeSchema = z.enum(["system", "light", "dark"]);

export function WorkspaceSettings(props: {
  preferences: Preferences;
  onPreferences: (preferences: Preferences) => void;
  connection: ReactNode;
}) {
  return (
    <div className="settings-page">
      <section aria-labelledby="appearance-heading">
        <h2 id="appearance-heading">Appearance and sound</h2>
        <label className="field">
          Theme
          <select
            name="theme"
            value={props.preferences.theme}
            onChange={(event) => {
              const theme = ThemeSchema.parse(event.target.value);
              props.onPreferences({ ...props.preferences, theme });
            }}
          >
            <option value="system">Use device setting</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={props.preferences.sound}
            onChange={(event) => {
              props.onPreferences({
                ...props.preferences,
                sound: event.target.checked,
              });
            }}
          />
          Play a sound when completing a task
        </label>
      </section>
      {props.connection}
      <section aria-labelledby="shortcuts-heading">
        <h2 id="shortcuts-heading">Keyboard shortcuts</h2>
        <dl className="shortcut-list">
          <dt>
            <kbd>Q</kbd>
          </dt>
          <dd>Add task</dd>
          <dt>
            <kbd>/</kbd>
          </dt>
          <dd>Search workspace</dd>
          <dt>
            <kbd>↑</kbd> <kbd>↓</kbd>
          </dt>
          <dd>Move between tasks</dd>
          <dt>
            <kbd>Enter</kbd>
          </dt>
          <dd>Open focused task</dd>
          <dt>
            <kbd>Esc</kbd>
          </dt>
          <dd>Close task or dialog</dd>
        </dl>
      </section>
    </div>
  );
}
