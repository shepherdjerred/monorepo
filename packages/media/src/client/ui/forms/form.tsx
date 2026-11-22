import {
  createContext,
  useContext,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { CircleAlertIcon, CircleCheckIcon, CircleDotIcon } from "lucide-react";
import { Button } from "#client/ui/button.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Callout } from "#client/ui/feedback.tsx";
import { constraintMessage } from "./validation.ts";
import styles from "./form.module.css";

const cx = classNames(styles);

type FieldError = { name: string; label: string; message: string };
type FormState = {
  errors: readonly FieldError[];
  edited: boolean;
  clear: (name: string) => void;
};

const FormContext = createContext<FormState>({
  errors: [],
  edited: false,
  clear: () => {
    // Outside a form there are no errors to clear.
  },
});

/** The error a form holds for the field with this name, if any. */
export function useFieldError(name: string | undefined): string | undefined {
  const { errors } = useContext(FormContext);
  return errors.find((error) => error.name === name)?.message;
}

/**
 * Clears a field's error. For a field the form cannot clear on its own: one
 * made of two controls, or one that is not an input. An input's own error
 * clears as the input changes.
 */
export function useClearFieldError(): (name: string) => void {
  return useContext(FormContext).clear;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The target as a form control, or `null` when it is something else. */
function asControl(target: unknown): Control | null {
  if (target instanceof HTMLInputElement) return target;
  if (target instanceof HTMLSelectElement) return target;
  return target instanceof HTMLTextAreaElement ? target : null;
}

/** Where a field's error points: its control, or the element standing in for a group. */
function fieldTargets(form: HTMLFormElement): HTMLElement[] {
  return [...form.querySelectorAll<HTMLElement>("[name], [data-field]")];
}

function fieldName(target: HTMLElement): string {
  return target.dataset["field"] ?? target.getAttribute("name") ?? "";
}

function focusField(form: HTMLFormElement, name: string) {
  const target = fieldTargets(form).find((item) => fieldName(item) === name);
  if (target === undefined) return;
  // A field inside a closed disclosure cannot take focus until it is open.
  for (
    let details = target.closest("details");
    details !== null;
    details = details.parentElement?.closest("details") ?? null
  ) {
    details.open = true;
  }
  target.focus();
}

/** Every problem with the form, in the order its fields appear. */
function collectErrors(
  form: HTMLFormElement,
  custom: Readonly<Record<string, string>>,
): FieldError[] {
  const messages = new Map<string, string>();
  for (const element of form.elements) {
    const control = asControl(element);
    if (control === null || control.name === "" || !control.willValidate) {
      continue;
    }
    const message = constraintMessage(control);
    if (message !== null && !messages.has(control.name)) {
      messages.set(control.name, message);
    }
  }
  // A control's own constraint is the more specific message for its field.
  for (const [name, message] of Object.entries(custom)) {
    if (!messages.has(name)) messages.set(name, message);
  }
  const errors: FieldError[] = [];
  for (const target of fieldTargets(form)) {
    const name = fieldName(target);
    const message = messages.get(name);
    if (message === undefined) continue;
    messages.delete(name);
    errors.push({ name, label: target.dataset["fieldLabel"] ?? name, message });
  }
  // An error with no field to point at is still an error.
  for (const [name, message] of messages) {
    errors.push({ name, label: name, message });
  }
  return errors;
}

/**
 * A form that checks itself. On submit it reads each control's own
 * constraints (`required`, `min`, `pattern`, …) plus `validate`, shows every
 * problem beside its field and in a summary, and moves focus to the first
 * one. `onSubmit` runs only when there is nothing wrong.
 *
 * While typing it stays quiet: a field is checked when focus leaves it after
 * an edit, and its error clears as soon as the value is acceptable. An error
 * found that way is also read out, once, from one polite live region.
 */
export function Form({
  children,
  labelledBy,
  validate,
  onSubmit,
  onEdit,
}: {
  children: ReactNode;
  /** The id of the heading that names this form. */
  labelledBy: string;
  /** Problems the controls cannot know about, by field name. */
  validate?: (form: HTMLFormElement) => Readonly<Record<string, string>>;
  onSubmit: (form: HTMLFormElement) => void;
  /** Called on the first edit after a submit. */
  onEdit?: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const touched = useRef(new Set<string>());
  const pressing = useRef(false);
  const leftWhilePressing = useRef<Control | null>(null);
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [summarized, setSummarized] = useState(false);
  const [edited, setEdited] = useState(false);
  const [announced, setAnnounced] = useState("");

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = collectErrors(
      event.currentTarget,
      validate?.(event.currentTarget) ?? {},
    );
    setErrors(found);
    setSummarized(found.length > 0);
    const [first] = found;
    if (first !== undefined) {
      focusField(event.currentTarget, first.name);
      return;
    }
    setEdited(false);
    touched.current.clear();
    onSubmit(event.currentTarget);
  }

  function change(event: SyntheticEvent<HTMLFormElement>) {
    if (!edited) {
      setEdited(true);
      onEdit?.();
    }
    const control = asControl(event.target);
    if (control === null) return;
    const { name } = control;
    touched.current.add(name);
    // Clear an error once the value is acceptable; never raise one mid-edit.
    if (control.validity.valid) clear(name);
  }

  function clear(name: string) {
    setErrors((current) => current.filter((error) => error.name !== name));
    setAnnounced("");
  }

  function check(control: Control) {
    const message = constraintMessage(control);
    if (message === null) return;
    const found = {
      name: control.name,
      label: control.dataset["fieldLabel"] ?? control.name,
      message,
    };
    // In place when the field already has an error, so the summary keeps
    // the order of the form.
    setErrors((current) =>
      current.some((error) => error.name === found.name)
        ? current.map((error) => (error.name === found.name ? found : error))
        : [...current, found],
    );
    // Focus has just moved on. Say the error a moment later, so it does
    // not talk over the field that focus arrived at.
    globalThis.setTimeout(() => {
      setAnnounced(`${found.label}: ${found.message}`);
    }, 500);
  }

  function blur(event: FocusEvent<HTMLFormElement>) {
    const control = asControl(event.target);
    if (control === null || !touched.current.has(control.name)) return;
    // Focus left because something in the form is being pressed. An error
    // appearing now would move that thing out from under the pointer and
    // lose the click, so the check waits until the click has landed.
    if (pressing.current) leftWhilePressing.current = control;
    else check(control);
  }

  function released() {
    pressing.current = false;
    const control = leftWhilePressing.current;
    leftWhilePressing.current = null;
    if (control !== null) check(control);
  }

  return (
    <FormContext value={{ errors, edited, clear }}>
      <form
        className={cx("form")}
        ref={form}
        aria-labelledby={labelledBy}
        noValidate
        onSubmit={submit}
        onChange={change}
        onBlur={blur}
        onPointerDown={() => {
          pressing.current = true;
        }}
        onPointerCancel={released}
        onClick={released}
      >
        {summarized && errors.length > 0 && (
          <div className={cx("summary")} role="alert">
            <p className={cx("summaryTitle")}>
              <CircleAlertIcon aria-hidden="true" />
              {errors.length === 1
                ? "1 field needs attention"
                : `${String(errors.length)} fields need attention`}
            </p>
            <ul className={cx("summaryList")}>
              {errors.map((error) => (
                <li key={error.name}>
                  <button
                    className={cx("summaryLink")}
                    type="button"
                    onClick={() => {
                      if (form.current !== null) {
                        focusField(form.current, error.name);
                      }
                    }}
                  >
                    {error.label}: {error.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {children}
        <p className="sr-only" aria-live="polite">
          {announced}
        </p>
      </form>
    </FormContext>
  );
}

/** Fields that belong on one line when there is room, such as a search box and its button. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className={cx("row")}>{children}</div>;
}

/**
 * The end of a form: its submit button and, beside it, where the form
 * stands. "Unsaved changes" appears on the first edit; the saved message
 * names what was saved and stays until the next edit.
 */
export function FormFooter({
  submitLabel,
  pendingLabel,
  pending,
  saved,
  error,
}: {
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  /** What was saved, in words, once it has been. */
  saved?: ReactNode;
  /** Why the last attempt was refused. */
  error?: Error | null;
}) {
  const { edited } = useContext(FormContext);
  // A change that was refused is still unsaved.
  const unsaved = edited || error != null;
  const showSaved = saved !== undefined && saved !== null && !unsaved;
  return (
    <div className={cx("footer")}>
      {error != null && !pending && (
        <Callout tone="danger">{error.message}</Callout>
      )}
      <div className={cx("footerRow")}>
        <Button type="submit" variant="primary" busy={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        <p className={cx("footerStatus")} role="status">
          {!pending && showSaved && (
            <span className={cx("saved")}>
              <CircleCheckIcon aria-hidden="true" />
              {saved}
            </span>
          )}
          {!pending && unsaved && (
            <span className={cx("unsaved")}>
              <CircleDotIcon aria-hidden="true" />
              Unsaved changes
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * What was last saved, by row. A row that is saved is usually loaded again
 * and remounted with its new version, which would lose its own "saved"
 * message; the list above the rows keeps it here instead.
 */
export function useSavedNotes() {
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  return {
    note: (id: string): string | null => notes[id] ?? null,
    saved: (id: string, message: string) => {
      setNotes((current) => ({ ...current, [id]: message }));
    },
    edited: (id: string) => {
      setNotes((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== id),
        ),
      );
    },
  };
}
