import { useId, type ComponentProps, type ReactNode } from "react";
import { ChevronDownIcon, CircleAlertIcon } from "lucide-react";
import { classNames } from "#client/ui/class-names.ts";
import { useFieldError } from "./form.tsx";
import styles from "./field.module.css";

const cx = classNames(styles);

/** What every field has around its control. */
type FieldChrome = {
  /** The visible label. Also names the field in a form's error summary. */
  label: string;
  /** Help that stays visible: the format, the unit, what the value does. */
  description?: ReactNode;
  /** Marks the field as one that may be left empty. */
  optional?: boolean;
  /** An error from outside the surrounding form's own validation. */
  error?: string | undefined;
};

/** Messages for the control's own constraints, read by `ui/validation.ts`. */
type RequiredMessage = { requiredMessage?: string | undefined };
type ConstraintMessages = RequiredMessage & {
  patternMessage?: string | undefined;
};

type Width = "short" | "medium" | "full";

/** The ids that tie a control to its help and its error. */
function useField(
  name: string | undefined,
  chrome: Pick<FieldChrome, "description" | "error">,
) {
  const id = useId();
  const formError = useFieldError(name);
  const error = chrome.error ?? formError;
  const descriptionId =
    chrome.description === undefined ? undefined : `${id}-description`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  return { id, error, descriptionId, errorId };
}

function describedBy(...ids: (string | undefined)[]): string | undefined {
  const present = ids.filter((id) => id !== undefined);
  return present.length === 0 ? undefined : present.join(" ");
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p className={cx("error")} id={id}>
      <CircleAlertIcon aria-hidden="true" />
      {message}
    </p>
  );
}

function FieldLabel({
  htmlFor,
  label,
  optional,
}: {
  htmlFor: string;
  label: string;
  optional: boolean;
}) {
  return (
    <label className={cx("label")} htmlFor={htmlFor}>
      {label}
      {optional && <span className={cx("optional")}> (optional)</span>}
    </label>
  );
}

type FrameProps = FieldChrome & {
  field: ReturnType<typeof useField>;
  width: Width;
  children: ReactNode;
};

/** Label, help, the control, then its error. */
function FieldFrame({
  label,
  description,
  optional = false,
  field,
  width,
  children,
}: FrameProps) {
  return (
    <div className={cx("field")} data-width={width}>
      <FieldLabel htmlFor={field.id} label={label} optional={optional} />
      {description !== undefined && (
        <p className={cx("description")} id={field.descriptionId}>
          {description}
        </p>
      )}
      {children}
      {field.error !== undefined && field.errorId !== undefined && (
        <FieldError id={field.errorId} message={field.error} />
      )}
    </div>
  );
}

type InputProps = FieldChrome &
  ConstraintMessages &
  Omit<ComponentProps<"input">, "id" | "className"> & {
    /** What the number counts, shown after the control: "seconds", "GiB". */
    unit?: string;
    /** A second control on the same line, such as a choice of unit. */
    after?: ReactNode;
    width?: Width;
  };

/** A one-line input of any type: text, number, search, password, file. */
export function TextField({
  label,
  description,
  optional = false,
  error,
  requiredMessage,
  patternMessage,
  unit,
  after,
  width,
  ...input
}: InputProps) {
  const field = useField(input.name, { description, error });
  const unitId = unit === undefined ? undefined : `${field.id}-unit`;
  const control = (
    <input
      {...input}
      className={cx("control")}
      id={field.id}
      data-field-label={label}
      data-required-message={requiredMessage}
      data-pattern-message={patternMessage}
      aria-invalid={field.error !== undefined}
      aria-describedby={describedBy(unitId, field.descriptionId, field.errorId)}
    />
  );
  return (
    <FieldFrame
      label={label}
      description={description}
      optional={optional}
      field={field}
      width={width ?? (input.type === "number" ? "short" : "full")}
    >
      {unit === undefined && after === undefined ? (
        control
      ) : (
        <div className={cx("withUnit")}>
          {control}
          {unit !== undefined && (
            <span className={cx("unit")} id={unitId}>
              {unit}
            </span>
          )}
          {after}
        </div>
      )}
    </FieldFrame>
  );
}

type SelectProps = FieldChrome &
  RequiredMessage &
  Omit<ComponentProps<"select">, "id" | "className"> & { width?: Width };

/** A native select, with the product's border and arrow. */
export function SelectField({
  label,
  description,
  optional = false,
  error,
  requiredMessage,
  width = "full",
  children,
  ...select
}: SelectProps) {
  const field = useField(select.name, { description, error });
  return (
    <FieldFrame
      label={label}
      description={description}
      optional={optional}
      field={field}
      width={width}
    >
      <div className={cx("selectWrap")}>
        <select
          {...select}
          className={`${cx("control")} ${cx("select")}`}
          id={field.id}
          data-field-label={label}
          data-required-message={requiredMessage}
          aria-invalid={field.error !== undefined}
          aria-describedby={describedBy(field.descriptionId, field.errorId)}
        >
          {children}
        </select>
        <ChevronDownIcon aria-hidden="true" />
      </div>
    </FieldFrame>
  );
}

/**
 * A select that sits beside another control and shares its visible label,
 * such as the unit of a size. `label` names it for assistive technology.
 */
export function InlineSelect({
  label,
  children,
  ...select
}: Omit<ComponentProps<"select">, "id" | "className"> & { label: string }) {
  const id = useId();
  return (
    <div className={cx("inlineSelect")}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <div className={cx("selectWrap")}>
        <select
          {...select}
          className={`${cx("control")} ${cx("select")}`}
          id={id}
        >
          {children}
        </select>
        <ChevronDownIcon aria-hidden="true" />
      </div>
    </div>
  );
}

type TextAreaProps = FieldChrome &
  RequiredMessage &
  Omit<ComponentProps<"textarea">, "id" | "className">;

export function TextAreaField({
  label,
  description,
  optional = false,
  error,
  requiredMessage,
  ...textarea
}: TextAreaProps) {
  const field = useField(textarea.name, { description, error });
  return (
    <FieldFrame
      label={label}
      description={description}
      optional={optional}
      field={field}
      width="full"
    >
      <textarea
        {...textarea}
        className={`${cx("control")} ${cx("textarea")}`}
        id={field.id}
        data-field-label={label}
        data-required-message={requiredMessage}
        aria-invalid={field.error !== undefined}
        aria-describedby={describedBy(field.descriptionId, field.errorId)}
      />
    </FieldFrame>
  );
}

type CheckboxProps = Omit<FieldChrome, "optional"> &
  RequiredMessage &
  Omit<ComponentProps<"input">, "id" | "className" | "type">;

/** A checkbox with its label beside it. */
export function CheckboxField({
  label,
  description,
  error,
  requiredMessage,
  ...input
}: CheckboxProps) {
  const field = useField(input.name, { description, error });
  return (
    <div className={cx("checkField")}>
      <div className={cx("checkRow")}>
        <input
          {...input}
          className={cx("check")}
          type="checkbox"
          id={field.id}
          data-field-label={label}
          data-required-message={requiredMessage}
          aria-invalid={field.error !== undefined}
          aria-describedby={describedBy(field.descriptionId, field.errorId)}
        />
        <div className={cx("checkText")}>
          <label className={cx("checkLabel")} htmlFor={field.id}>
            {label}
          </label>
          {description !== undefined && (
            <p className={cx("description")} id={field.descriptionId}>
              {description}
            </p>
          )}
        </div>
      </div>
      {field.error !== undefined && field.errorId !== undefined && (
        <FieldError id={field.errorId} message={field.error} />
      )}
    </div>
  );
}

type Choice = { value: string; label: string; description?: string };

/**
 * A few exclusive options, all visible: a radio group. Use a select when
 * there are more than about five.
 */
export function ChoiceField({
  legend,
  description,
  name,
  options,
  value,
  defaultValue,
  onChange,
  disabled = false,
  layout = "row",
}: {
  legend: string;
  description?: ReactNode;
  name: string;
  options: readonly Choice[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  /** `stack` puts each option on its own line, for options with help text. */
  layout?: "row" | "stack";
}) {
  const id = useId();
  const descriptionId = description === undefined ? undefined : `${id}-help`;
  return (
    <fieldset
      className={cx("group")}
      disabled={disabled}
      aria-describedby={descriptionId}
    >
      <legend className={cx("label")}>{legend}</legend>
      {description !== undefined && (
        <p className={cx("description")} id={descriptionId}>
          {description}
        </p>
      )}
      <div className={cx("choices")} data-layout={layout}>
        {options.map((option) => (
          <label className={cx("choice")} key={option.value}>
            <input
              className={cx("radio")}
              type="radio"
              name={name}
              value={option.value}
              data-field-label={legend}
              {...(value === undefined
                ? { defaultChecked: defaultValue === option.value }
                : {
                    checked: value === option.value,
                    onChange: () => {
                      onChange?.(option.value);
                    },
                  })}
            />
            <span className={cx("choiceText")}>
              {option.label}
              {option.description !== undefined && (
                <span className={cx("choiceHelp")}>{option.description}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A group of fields with a name of its own. */
export function FieldGroup({
  legend,
  description,
  children,
}: {
  legend: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset
      className={cx("group")}
      aria-describedby={description === undefined ? undefined : id}
    >
      <legend className={cx("groupLegend")}>{legend}</legend>
      {description !== undefined && (
        <p className={cx("description")} id={id}>
          {description}
        </p>
      )}
      <div className={cx("groupBody")}>{children}</div>
    </fieldset>
  );
}
