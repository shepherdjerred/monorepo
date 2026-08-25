import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Ref,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import {
  createFormHook,
  createFormHookContexts,
  revalidateLogic,
} from "@tanstack/react-form";
import { z } from "zod";
import {
  Field,
  FieldDescription,
  FieldError,
  Input,
  Label,
  Textarea,
} from "@scout-for-lol/design-system/components/input";

const StandardIssueSchema = z.object({ message: z.string() });

export function fieldErrorMessage(errors: unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === "string") return error;
    const parsed = StandardIssueSchema.safeParse(error);
    if (parsed.success) return parsed.data.message;
  }
  return undefined;
}

function describedBy(
  descriptionId: string | undefined,
  errorId: string,
  invalid: boolean,
): string | undefined {
  const ids = [descriptionId, invalid ? errorId : undefined].filter(
    (id) => id !== undefined,
  );
  return ids.length === 0 ? undefined : ids.join(" ");
}

const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

type CommonFieldProps = {
  id: string;
  label: ReactNode;
  description?: ReactNode | undefined;
  fieldClassName?: string | undefined;
};

function LabeledControl(
  props: CommonFieldProps & {
    error: string | undefined;
    children: (presentation: {
      invalid: true | undefined;
      describedBy: string | undefined;
    }) => ReactNode;
  },
) {
  const errorId = `${props.id}-error`;
  const descriptionId =
    props.description === undefined ? undefined : `${props.id}-description`;
  return (
    <Field className={props.fieldClassName}>
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children({
        invalid: props.error === undefined ? undefined : true,
        describedBy: describedBy(
          descriptionId,
          errorId,
          props.error !== undefined,
        ),
      })}
      {props.description === undefined ? null : (
        <FieldDescription id={descriptionId}>
          {props.description}
        </FieldDescription>
      )}
      {props.error === undefined ? null : (
        <FieldError id={errorId}>{props.error}</FieldError>
      )}
    </Field>
  );
}

type NativeControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function useNativeConstraintError<TControl extends NativeControl>(
  value: string,
) {
  const controlRef = useRef<TControl>(null);
  const [nativeError, setNativeError] = useState<{
    value: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    const form = controlRef.current?.form;
    if (form === undefined || form === null) return;
    const clearError = () => {
      setNativeError(null);
    };
    form.addEventListener("reset", clearError);
    return () => {
      form.removeEventListener("reset", clearError);
    };
  }, []);

  return {
    controlRef,
    nativeError: nativeError?.value === value ? nativeError.message : undefined,
    updateNativeError: (control: TControl) => {
      if (nativeError?.value !== value) return;
      setNativeError(
        control.validity.valid
          ? null
          : { value: control.value, message: control.validationMessage },
      );
    },
    captureNativeError: (control: TControl) => {
      setNativeError({
        value: control.value,
        message: control.validationMessage,
      });
    },
  };
}

function setRef<TValue>(ref: Ref<TValue> | undefined, value: TValue | null) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref !== undefined && ref !== null) {
    ref.current = value;
  }
}

function nativeControlProps<TControl extends NativeControl>(props: {
  name: string;
  value: string;
  presentation: { invalid: true | undefined; describedBy: string | undefined };
  onValueChange: (value: string) => void;
  onBlur: () => void;
  updateNativeError: (control: TControl) => void;
  captureNativeError: (control: TControl) => void;
}) {
  return {
    name: props.name,
    value: props.value,
    "aria-invalid": props.presentation.invalid,
    "aria-describedby": props.presentation.describedBy,
    onChange: (event: ChangeEvent<TControl>) => {
      props.onValueChange(event.currentTarget.value);
      props.updateNativeError(event.currentTarget);
    },
    onBlur: props.onBlur,
    onInvalid: (event: SyntheticEvent<TControl>) => {
      props.captureNativeError(event.currentTarget);
    },
  };
}

type TextFieldProps = CommonFieldProps &
  Omit<
    React.ComponentProps<typeof Input>,
    | "id"
    | "name"
    | "value"
    | "onChange"
    | "onBlur"
    | "onInvalid"
    | "aria-describedby"
    | "aria-invalid"
  >;

function TextField(props: TextFieldProps) {
  const field = useFieldContext<string>();
  const { controlRef, nativeError, updateNativeError, captureNativeError } =
    useNativeConstraintError<HTMLInputElement>(field.state.value);
  const { id, label, description, fieldClassName, ref, ...inputProps } = props;
  const schemaError = field.state.meta.isTouched
    ? fieldErrorMessage(field.state.meta.errors)
    : undefined;
  const error = nativeError ?? schemaError;
  const presentationProps = {
    id,
    label,
    description,
    fieldClassName,
    error,
  };

  return (
    <LabeledControl {...presentationProps}>
      {(presentation) => (
        <Input
          {...inputProps}
          ref={(input) => {
            controlRef.current = input;
            setRef(ref, input);
          }}
          id={id}
          {...nativeControlProps<HTMLInputElement>({
            name: field.name,
            value: field.state.value,
            presentation,
            onValueChange: field.handleChange,
            onBlur: field.handleBlur,
            updateNativeError,
            captureNativeError,
          })}
        />
      )}
    </LabeledControl>
  );
}

type TextareaFieldProps = CommonFieldProps &
  Omit<
    React.ComponentProps<typeof Textarea>,
    | "id"
    | "name"
    | "value"
    | "onChange"
    | "onBlur"
    | "onInvalid"
    | "aria-describedby"
    | "aria-invalid"
  >;

function TextareaField(props: TextareaFieldProps) {
  const field = useFieldContext<string>();
  const { controlRef, nativeError, updateNativeError, captureNativeError } =
    useNativeConstraintError<HTMLTextAreaElement>(field.state.value);
  const { id, label, description, fieldClassName, ref, ...textareaProps } =
    props;
  const schemaError = field.state.meta.isTouched
    ? fieldErrorMessage(field.state.meta.errors)
    : undefined;
  const error = nativeError ?? schemaError;
  const presentationProps = {
    id,
    label,
    description,
    fieldClassName,
    error,
  };

  return (
    <LabeledControl {...presentationProps}>
      {(presentation) => (
        <Textarea
          {...textareaProps}
          ref={(textarea) => {
            controlRef.current = textarea;
            setRef(ref, textarea);
          }}
          id={id}
          {...nativeControlProps<HTMLTextAreaElement>({
            name: field.name,
            value: field.state.value,
            presentation,
            onValueChange: field.handleChange,
            onBlur: field.handleBlur,
            updateNativeError,
            captureNativeError,
          })}
        />
      )}
    </LabeledControl>
  );
}

type NativeSelectFieldProps = CommonFieldProps & {
  options: readonly { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
};

function NativeSelectField(props: NativeSelectFieldProps) {
  const field = useFieldContext<string>();
  const { controlRef, nativeError, updateNativeError, captureNativeError } =
    useNativeConstraintError<HTMLSelectElement>(field.state.value);
  const schemaError = field.state.meta.isTouched
    ? fieldErrorMessage(field.state.meta.errors)
    : undefined;
  const error = nativeError ?? schemaError;

  return (
    <LabeledControl {...props} error={error}>
      {(presentation) => (
        <select
          ref={controlRef}
          className="scout-control"
          id={props.id}
          name={field.name}
          value={field.state.value}
          required={props.required}
          disabled={props.disabled}
          aria-invalid={presentation.invalid}
          aria-describedby={presentation.describedBy}
          onChange={(event) => {
            const select = event.currentTarget;
            field.handleChange(select.value);
            props.onValueChange?.(select.value);
            updateNativeError(select);
          }}
          onBlur={field.handleBlur}
          onInvalid={(event) => {
            captureNativeError(event.currentTarget);
          }}
        >
          {props.placeholder === undefined ? null : (
            <option value="" disabled>
              {props.placeholder}
            </option>
          )}
          {props.options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      )}
    </LabeledControl>
  );
}

export const { useAppForm: useScoutForm, withForm: withScoutForm } =
  createFormHook({
    fieldComponents: { TextField, TextareaField, NativeSelectField },
    formComponents: {},
    fieldContext,
    formContext,
  });

export const submitThenChangeValidation = revalidateLogic({
  mode: "submit",
  modeAfterSubmission: "change",
});

export function handleFormSubmit(
  event: SyntheticEvent<HTMLFormElement>,
  submit: () => Promise<void>,
): void {
  event.preventDefault();
  void submit();
}

export function handleFormReset(
  event: SyntheticEvent<HTMLFormElement>,
  reset: () => void,
): void {
  event.preventDefault();
  reset();
}

export function focusFirstInvalid(container: HTMLElement | null): void {
  requestAnimationFrame(() => {
    container?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

export function ServerFormError(props: { error: string | null }) {
  return props.error === null ? null : (
    <p role="alert" className="scout-field__error">
      {props.error}
    </p>
  );
}

export function FormPendingStatus(props: {
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {props.pending ? props.children : null}
    </p>
  );
}
