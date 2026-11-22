import { useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, IconButton } from "#client/ui/button.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { SelectField, TextField } from "./field.tsx";
import { useClearFieldError, useFieldError } from "./form.tsx";
import styles from "./list-editor.module.css";

const cx = classNames(styles);

type Suggestion = { value: string; label?: string; group?: string };

/** The select's value for "none of these: let me type one". */
const OTHER = "__other__";

function focus(id: string) {
  document.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.focus();
}

function Options({ suggestions }: { suggestions: readonly Suggestion[] }) {
  const groups = [...new Set(suggestions.map((item) => item.group))];
  return groups.map((group) => {
    const options = suggestions
      .filter((item) => item.group === group)
      .map((item) => (
        <option key={item.value} value={item.value}>
          {item.label ?? item.value}
        </option>
      ));
    return group === undefined ? (
      options
    ) : (
      <optgroup key={group} label={group}>
        {options}
      </optgroup>
    );
  });
}

/**
 * A list of distinct text values, edited in place. Every action is a
 * button, so it works the same with a keyboard, a pointer, or a switch:
 * with `ordered`, each item moves up and down one place at a time. A value
 * is added from the suggestions or typed.
 */
export function ListEditor({
  legend,
  description,
  name,
  items,
  onChange,
  ordered = false,
  suggestions,
  addLabel,
  otherLabel,
  empty,
  note,
}: {
  legend: string;
  description?: ReactNode;
  /** The field's name, for the surrounding form's errors. */
  name: string;
  items: readonly string[];
  onChange: (items: string[]) => void;
  /** The order means something: number the items and offer to move them. */
  ordered?: boolean;
  suggestions: readonly Suggestion[];
  /** Labels the control that adds an item: "Add a quality". */
  addLabel: string;
  /** Labels the box for a value that is not suggested: "Quality name". */
  otherLabel: string;
  /** Shown while the list has nothing in it. */
  empty: string;
  /** Something to say beside one item, such as a marker. */
  note?: (item: string) => ReactNode;
}) {
  const id = useId();
  const formError = useFieldError(name);
  const clearFormError = useClearFieldError();
  const picker = useRef<HTMLSelectElement>(null);
  const [choice, setChoice] = useState("");
  const [other, setOther] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const descriptionId = description === undefined ? undefined : `${id}-help`;
  const unused = suggestions.filter((item) => !items.includes(item.value));

  /** Applies a change now, so focus can follow the item it moved. */
  function commit(next: string[], said: string) {
    flushSync(() => {
      onChange(next);
      setAnnouncement(said);
    });
    clearFormError(name);
  }

  function move(index: number, step: -1 | 1) {
    const item = items[index];
    const to = index + step;
    if (item === undefined || to < 0 || to >= items.length) return;
    const next = [...items];
    next.splice(index, 1);
    next.splice(to, 0, item);
    commit(
      next,
      `${item} moved ${step === -1 ? "up" : "down"}, now ${String(to + 1)} of ${String(items.length)}.`,
    );
    // At either end the button just used is disabled; its twin is not.
    const atEnd = step === -1 ? to === 0 : to === items.length - 1;
    const direction = (step === -1) === atEnd ? "down" : "up";
    focus(`${id}-${String(to)}-${direction}`);
  }

  function remove(index: number) {
    const item = items[index];
    if (item === undefined) return;
    commit(
      items.filter((_, position) => position !== index),
      `${item} removed.`,
    );
    if (items.length === 1) picker.current?.focus();
    else focus(`${id}-${String(Math.min(index, items.length - 2))}-remove`);
  }

  function add() {
    const value = choice === OTHER ? other.trim() : choice;
    if (value === "") {
      setAddError(
        choice === OTHER ? "Type what to add." : "Choose what to add.",
      );
      return;
    }
    if (items.includes(value)) {
      setAddError(`${value} is already in the list.`);
      return;
    }
    setAddError(null);
    setChoice("");
    setOther("");
    commit(
      [...items, value],
      ordered
        ? `${value} added at the bottom, ${String(items.length + 1)} of ${String(items.length + 1)}.`
        : `${value} added.`,
    );
    // The box for a typed value has gone; the picker is what is left.
    if (choice === OTHER) picker.current?.focus();
  }

  const List = ordered ? "ol" : "ul";
  return (
    <fieldset className={cx("editor")} aria-describedby={descriptionId}>
      <legend className={cx("legend")}>{legend}</legend>
      {description !== undefined && (
        <p className={cx("description")} id={descriptionId}>
          {description}
        </p>
      )}
      {items.length === 0 ? (
        <p className={cx("empty")}>{empty}</p>
      ) : (
        <List className={cx("items")}>
          {items.map((item, index) => (
            <li className={cx("item")} key={item}>
              {ordered && (
                <span className={cx("rank")} aria-hidden="true">
                  {index + 1}
                </span>
              )}
              <span className={cx("name")}>{item}</span>
              {note !== undefined && (
                <span className={cx("note")}>{note(item)}</span>
              )}
              <span className={cx("actions")}>
                {ordered && (
                  <>
                    <IconButton
                      id={`${id}-${String(index)}-up`}
                      label={`Move ${item} up`}
                      disabled={index === 0}
                      onClick={() => {
                        move(index, -1);
                      }}
                    >
                      <ArrowUpIcon aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      id={`${id}-${String(index)}-down`}
                      label={`Move ${item} down`}
                      disabled={index === items.length - 1}
                      onClick={() => {
                        move(index, 1);
                      }}
                    >
                      <ArrowDownIcon aria-hidden="true" />
                    </IconButton>
                  </>
                )}
                <IconButton
                  id={`${id}-${String(index)}-remove`}
                  label={`Remove ${item}`}
                  onClick={() => {
                    remove(index);
                  }}
                >
                  <XIcon aria-hidden="true" />
                </IconButton>
              </span>
            </li>
          ))}
        </List>
      )}
      <div className={cx("add")}>
        <SelectField
          ref={picker}
          label={addLabel}
          data-field={name}
          error={addError ?? formError}
          value={choice}
          onChange={(event) => {
            setChoice(event.target.value);
            setAddError(null);
          }}
          width="medium"
        >
          <option value="">Choose…</option>
          <Options suggestions={unused} />
          <option value={OTHER}>Something else…</option>
        </SelectField>
        {choice === OTHER && (
          <TextField
            label={otherLabel}
            value={other}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            onChange={(event) => {
              setOther(event.target.value);
              setAddError(null);
            }}
            onKeyDown={(event) => {
              // Enter adds the value; it must not submit the whole form.
              if (event.key !== "Enter" || event.nativeEvent.isComposing) {
                return;
              }
              event.preventDefault();
              add();
            }}
            width="medium"
          />
        )}
        <Button onClick={add}>
          <PlusIcon aria-hidden="true" />
          Add
        </Button>
      </div>
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </fieldset>
  );
}
