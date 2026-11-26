import {
  useCallback,
  useId,
  useRef,
  useState,
  type RefObject,
  type SubmitEvent,
} from "react";
import { z } from "zod";
import { Button, Field } from "@shepherdjerred/console-ui";
import type {
  CategorySummary,
  CreateUserFeedBody,
  FeedHealthItem,
  UpdateUserFeedBody,
} from "@shepherdjerred/feeds/shared/contract.ts";
import {
  draftFromFeed,
  emptyUserFeedDraft,
  toCreateUserFeedBody,
  toUpdateUserFeedBody,
  validateUserFeedDraft,
  validateUserFeedField,
  type UserFeedDraft,
  type UserFeedErrors,
  type UserFeedField,
} from "./model.ts";

export const DIALOG_LIGHT_DISMISS_PROPS: Readonly<Record<string, string>> = {
  closedby: "any",
};

export type UserFeedDialogState =
  | { readonly kind: "closed" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly feed: FeedHealthItem };

export type UserFeedDialogProps = {
  readonly state: UserFeedDialogState;
  readonly categories: readonly CategorySummary[];
  readonly onClose: () => void;
  readonly onCreate: (body: CreateUserFeedBody) => Promise<void>;
  readonly onUpdate: (id: number, body: UpdateUserFeedBody) => Promise<void>;
};

const FIELD_ORDER: readonly UserFeedField[] = [
  "url",
  "title",
  "category",
  "htmlUrl",
  "autoReadPattern",
];

function withoutFieldError(
  errors: UserFeedErrors,
  omitted: UserFeedField,
): UserFeedErrors {
  return Object.fromEntries(
    Object.entries(errors).filter(([key]) => key !== omitted),
  );
}

/**
 * The ref callback for a modal `<dialog>`: it keeps the element's open state
 * equal to `isOpen`, and adds the Safari light-dismiss fallback when
 * `<dialog closedby="any">` is unsupported. It also stores the element in
 * `dialogRef`, which the dialog's own handlers read.
 */
export function useModalDialogRef(
  dialogRef: RefObject<HTMLDialogElement | null>,
  isOpen: boolean,
): (dialog: HTMLDialogElement | null) => (() => void) | undefined {
  return useCallback(
    (dialog: HTMLDialogElement | null) => {
      dialogRef.current = dialog;
      if (dialog === null) return;
      if (!isOpen) {
        if (dialog.open) dialog.close();
      } else if (!dialog.open) {
        dialog.showModal();
      }
      const lightDismissUnsupported =
        typeof HTMLDialogElement !== "undefined" &&
        !("closedBy" in HTMLDialogElement.prototype);
      const onClick = (event: MouseEvent): void => {
        if (event.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        const inside =
          r.top <= event.clientY &&
          event.clientY <= r.bottom &&
          r.left <= event.clientX &&
          event.clientX <= r.right;
        if (!inside) dialog.close();
      };
      if (lightDismissUnsupported) dialog.addEventListener("click", onClick);
      return () => {
        if (lightDismissUnsupported) {
          dialog.removeEventListener("click", onClick);
        }
        dialogRef.current = null;
      };
    },
    [dialogRef, isOpen],
  );
}

function focusFirstInvalid(
  form: HTMLFormElement | null,
  errors: UserFeedErrors,
): void {
  if (form === null) return;
  for (const field of FIELD_ORDER) {
    if (errors[field] !== undefined) {
      const element = form.elements.namedItem(field);
      if (element instanceof HTMLElement) element.focus();
      return;
    }
  }
}

type BoundInputProps = {
  readonly field: UserFeedField;
  readonly label: string;
  readonly value: string;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly type?: "text" | "url" | undefined;
  readonly placeholder?: string | undefined;
  readonly maxLength?: number | undefined;
  readonly listId?: string | undefined;
  readonly required?: boolean | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly identifier?: boolean | undefined;
  readonly mono?: boolean | undefined;
  readonly onChangeField: (field: UserFeedField, next: string) => void;
  readonly onBlurField: (field: UserFeedField) => void;
};

function BoundInput(props: BoundInputProps): React.JSX.Element {
  return (
    <Field
      label={props.label}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      {...(props.error === undefined ? {} : { error: props.error })}
    >
      {(control) => (
        <input
          {...control}
          type={props.type ?? "text"}
          name={props.field}
          className={
            props.mono === true
              ? `${control.className} ui-mono`
              : control.className
          }
          value={props.value}
          required={props.required}
          autoFocus={props.autoFocus}
          maxLength={props.maxLength}
          list={props.listId}
          placeholder={props.placeholder}
          autoComplete="off"
          {...(props.identifier === true
            ? { autoCorrect: "off", autoCapitalize: "none", spellCheck: false }
            : {})}
          onChange={(event) => {
            props.onChangeField(props.field, event.target.value);
          }}
          onBlur={() => {
            props.onBlurField(props.field);
          }}
        />
      )}
    </Field>
  );
}

function CheckboxField(props: {
  readonly name: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="fd-check-row">
      <input
        type="checkbox"
        id={id}
        name={props.name}
        checked={props.checked}
        onChange={(event) => {
          props.onChange(event.target.checked);
        }}
      />
      <label htmlFor={id}>{props.label}</label>
    </div>
  );
}

function UserFeedFields({
  draft,
  errors,
  editingFeed,
  userCategories,
  onChangeText,
  onChangeBool,
  onBlurField,
}: {
  readonly draft: UserFeedDraft;
  readonly errors: UserFeedErrors;
  readonly editingFeed: FeedHealthItem | undefined;
  readonly userCategories: readonly CategorySummary[];
  readonly onChangeText: (field: UserFeedField, value: string) => void;
  readonly onChangeBool: (
    key: "autoReadFlags" | "autoReadNegate" | "hidden",
    checked: boolean,
  ) => void;
  readonly onBlurField: (field: UserFeedField) => void;
}): React.JSX.Element {
  const categoryListId = useId();
  const isCreate = editingFeed === undefined;

  return (
    <>
      <BoundInput
        field="url"
        label={isCreate ? "Feed URL (required)" : "Replacement feed URL"}
        hint={
          isCreate
            ? "Atom or RSS URL, including private token URLs."
            : `Stored endpoint: ${editingFeed.displayUrl}`
        }
        error={errors.url}
        type="url"
        identifier
        value={draft.url}
        required={isCreate}
        autoFocus={isCreate}
        placeholder={
          isCreate
            ? "https://example.com/feed.xml"
            : "Leave blank to keep stored URL"
        }
        onChangeField={onChangeText}
        onBlurField={onBlurField}
      />
      <BoundInput
        field="title"
        label={isCreate ? "Title (optional)" : "Title (required)"}
        hint={
          isCreate
            ? "Defaults to the discovered feed title when blank."
            : undefined
        }
        error={errors.title}
        value={draft.title}
        maxLength={200}
        required={!isCreate}
        autoFocus={!isCreate}
        onChangeField={onChangeText}
        onBlurField={onBlurField}
      />
      <BoundInput
        field="category"
        label="Category (required)"
        hint="User-owned category label (managed categories are reserved for code)."
        error={errors.category}
        value={draft.category}
        maxLength={100}
        required
        listId={userCategories.length > 0 ? categoryListId : undefined}
        onChangeField={onChangeText}
        onBlurField={onBlurField}
      />
      {userCategories.length > 0 ? (
        <datalist id={categoryListId}>
          {userCategories.map((category) => (
            <option key={category.id} value={category.label} />
          ))}
        </datalist>
      ) : null}
      <BoundInput
        field="htmlUrl"
        label="Site URL (optional)"
        error={errors.htmlUrl}
        type="url"
        identifier
        value={draft.htmlUrl}
        placeholder="https://example.com"
        onChangeField={onChangeText}
        onBlurField={onBlurField}
      />
      <fieldset className="fd-fieldset">
        <legend>Filtering &amp; auto-read</legend>
        <BoundInput
          field="autoReadPattern"
          label="Title auto-read regex (optional)"
          hint="Matching entries arrive marked read automatically."
          error={errors.autoReadPattern}
          identifier
          mono
          value={draft.autoReadPattern}
          placeholder={String.raw`e.g. \b(alpha|beta|rc)\b`}
          onChangeField={onChangeText}
          onBlurField={onBlurField}
        />
        <CheckboxField
          name="autoReadCaseInsensitive"
          label="Case-insensitive (`i`)"
          checked={draft.autoReadFlags === "i"}
          onChange={(checked) => {
            onChangeBool("autoReadFlags", checked);
          }}
        />
        <CheckboxField
          name="autoReadNegate"
          label="Auto-read titles that do NOT match pattern"
          checked={draft.autoReadNegate}
          onChange={(checked) => {
            onChangeBool("autoReadNegate", checked);
          }}
        />
        <CheckboxField
          name="hidden"
          label="Hide feed from default unread stream"
          checked={draft.hidden}
          onChange={(checked) => {
            onChangeBool("hidden", checked);
          }}
        />
      </fieldset>
    </>
  );
}

export function UserFeedDialog({
  state,
  categories,
  onClose,
  onCreate,
  onUpdate,
}: UserFeedDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const editingFeed = state.kind === "edit" ? state.feed : undefined;
  const mode: "create" | "edit" = editingFeed === undefined ? "create" : "edit";

  const [draft, setDraft] = useState<UserFeedDraft>(() =>
    editingFeed === undefined
      ? emptyUserFeedDraft()
      : draftFromFeed(editingFeed),
  );
  const [touched, setTouched] = useState<
    Partial<Record<UserFeedField, boolean>>
  >({});
  const [errors, setErrors] = useState<UserFeedErrors>({});
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  // A new dialog state starts a fresh form: adjust during render, not in an effect.
  const [formState, setFormState] = useState(state);
  if (formState !== state) {
    setFormState(state);
    setDraft(
      state.kind === "edit" ? draftFromFeed(state.feed) : emptyUserFeedDraft(),
    );
    setTouched({});
    setErrors({});
    setSubmitError(undefined);
    setIsSaving(false);
  }

  const dialogRefCallback = useModalDialogRef(
    dialogRef,
    state.kind !== "closed",
  );

  function handleFieldBlur(field: UserFeedField): void {
    if (touched[field] !== true) return;
    const message = validateUserFeedField(draft, field, mode);
    setErrors((prev) =>
      message === undefined
        ? withoutFieldError(prev, field)
        : { ...prev, [field]: message },
    );
  }

  function handleChangeText(field: UserFeedField, value: string): void {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setTouched((prev) => ({ ...prev, [field]: true }));
    setSubmitError(undefined);
    setErrors((prev) => withoutFieldError(prev, field));
  }

  function handleChangeBool(
    key: "autoReadFlags" | "autoReadNegate" | "hidden",
    checked: boolean,
  ): void {
    if (key === "autoReadFlags") {
      setDraft((prev) => ({ ...prev, autoReadFlags: checked ? "i" : "" }));
      setTouched((prev) => ({ ...prev, autoReadPattern: true }));
      setSubmitError(undefined);
      setErrors((prev) => withoutFieldError(prev, "autoReadPattern"));
      return;
    }
    setDraft((prev) => ({ ...prev, [key]: checked }));
  }

  async function handleSubmit(
    event: SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSaving) return;
    const nextErrors = validateUserFeedDraft(draft, mode);
    setTouched({
      url: true,
      title: true,
      category: true,
      htmlUrl: true,
      autoReadPattern: true,
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalid(formRef.current, nextErrors);
      return;
    }
    setIsSaving(true);
    setSubmitError(undefined);
    try {
      await (editingFeed === undefined
        ? onCreate(toCreateUserFeedBody(draft))
        : onUpdate(editingFeed.id, toUpdateUserFeedBody(draft)));
      dialogRef.current?.close("saved");
    } catch (error: unknown) {
      const parsed = z.object({ message: z.string() }).safeParse(error);
      setSubmitError(parsed.success ? parsed.data.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  }

  const userCategories = categories.filter((category) => !category.managed);
  const submitLabel = isSaving
    ? "Saving…"
    : editingFeed === undefined
      ? "Add feed"
      : "Save changes";

  return (
    <dialog
      {...DIALOG_LIGHT_DISMISS_PROPS}
      ref={dialogRefCallback}
      className="fd-dialog"
      aria-labelledby={titleId}
      onClose={() => {
        if (dialogRef.current !== null) dialogRef.current.returnValue = "";
        onClose();
      }}
    >
      <h1 id={titleId} className="fd-dialog-title">
        {editingFeed === undefined ? "Add user feed" : "Edit user feed"}
      </h1>
      <form
        ref={formRef}
        method="POST"
        action={
          editingFeed === undefined
            ? "/api/v1/feeds"
            : `/api/v1/feeds/${String(editingFeed.id)}`
        }
        className="fd-dialog-form"
        noValidate
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <UserFeedFields
          draft={draft}
          errors={errors}
          editingFeed={editingFeed}
          userCategories={userCategories}
          onChangeText={handleChangeText}
          onChangeBool={handleChangeBool}
          onBlurField={handleFieldBlur}
        />
        {submitError === undefined ? null : (
          <p role="alert" className="ui-field-error">
            {submitError}
          </p>
        )}
        <div className="fd-dialog-actions">
          <Button
            type="button"
            onClick={() => dialogRef.current?.close("cancel")}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSaving}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
