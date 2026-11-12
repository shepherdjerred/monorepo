import { useState } from "react";
import { Modal } from "#client/ui/ui.tsx";
import { isComposing } from "#client/ui/ime.ts";
import { viewIcons } from "./view-icons.tsx";
import type { SavedView } from "./view-params.ts";

export type ViewDraft = {
  name: string;
  icon: string;
  /** The team the view belongs to, or null for every team. */
  teamKey: string | null;
};

/**
 * Name a view, give it an icon and say whose it is: this team's, or every
 * team's. Used to save a new view and to rename or re-scope one.
 */
export function ViewDialog({
  open,
  title,
  submitLabel,
  teamKey,
  view,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  /** The team in view, which "This team" means. */
  teamKey: string;
  view?: SavedView;
  onSubmit: (draft: ViewDraft) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(view?.name ?? "");
  const [icon, setIcon] = useState(view?.icon ?? "list");
  const [global, setGlobal] = useState(view?.teamKey === null);
  const ownTeam = view?.teamKey ?? teamKey;
  return (
    <Modal title={title} open={open} onClose={onClose} className="view-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "") {
            return;
          }
          onSubmit({
            name: name.trim(),
            icon,
            teamKey: global ? null : ownTeam,
          });
        }}
      >
        <label>
          Name
          <input
            name="view-name"
            value={name}
            required
            maxLength={200}
            placeholder="e.g. My overdue bugs"
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
            }}
            onKeyDown={(event) => {
              // The Enter that confirms an IME conversion does not submit.
              if (event.key === "Enter" && isComposing(event.nativeEvent)) {
                event.preventDefault();
              }
            }}
          />
        </label>
        <fieldset className="icon-choices">
          <legend>Icon</legend>
          {viewIcons.map((choice) => (
            <label
              key={choice.name}
              className="icon-choice"
              title={choice.label}
            >
              <input
                type="radio"
                name="view-icon"
                value={choice.name}
                checked={icon === choice.name}
                aria-label={choice.label}
                onChange={() => {
                  setIcon(choice.name);
                }}
              />
              <choice.Icon size={16} aria-hidden="true" />
            </label>
          ))}
        </fieldset>
        <fieldset className="scope-choices">
          <legend>Show in</legend>
          <label>
            <input
              type="radio"
              name="view-scope"
              checked={!global}
              onChange={() => {
                setGlobal(false);
              }}
            />
            This team ({ownTeam})
          </label>
          <label>
            <input
              type="radio"
              name="view-scope"
              checked={global}
              onChange={() => {
                setGlobal(true);
              }}
            />
            All teams
          </label>
        </fieldset>
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
