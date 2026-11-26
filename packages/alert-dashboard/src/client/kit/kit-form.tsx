import {
  Button,
  Checkbox,
  ErrorSummary,
  Field,
  Fieldset,
  FormActions,
  InputAddon,
  RadioGroup,
  SavedStatus,
  Switch,
  Textarea,
  collectErrorSummary,
  fieldErrorMessage,
} from "@shepherdjerred/console-ui";
import { useForm } from "@tanstack/react-form";
import { useCallback, useState } from "react";
import { z } from "zod";

const LinkSchema = z.object({
  slug: z
    .string()
    .min(2, "Use at least 2 characters.")
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, digits and hyphens."),
  target: z.url("Enter a full URL, starting with https://."),
  notes: z.string().max(80, "Keep notes under 80 characters."),
  severity: z.enum(["warning", "page"]),
  public: z.boolean(),
  notify: z.boolean(),
});

const FIELD_IDS = {
  slug: { label: "Short link", fieldId: "kit-slug" },
  target: { label: "Target URL", fieldId: "kit-target" },
  notes: { label: "Notes", fieldId: "kit-notes" },
} as const;

/**
 * A form on TanStack Form with a Zod schema. It starts already submitted
 * once, so the gallery shows the error summary and the field errors.
 */
export function KitForm(): React.JSX.Element {
  const [saved, setSaved] = useState(false);
  const form = useForm({
    defaultValues: {
      slug: "Home Assistant",
      target: "ha.local",
      notes: "",
      severity: "warning",
      public: false,
      notify: true,
    },
    validators: { onChange: LinkSchema, onSubmit: LinkSchema },
    onSubmit: () => {
      setSaved(true);
    },
  });
  // A stable ref callback runs once when the form mounts: the gallery submits
  // it then so its errors are on show.
  const submitOnMount = useCallback(() => {
    void form.handleSubmit();
  }, [form]);

  return (
    <form
      className="kit-form"
      noValidate
      ref={submitOnMount}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Subscribe selector={(state) => state.fieldMeta}>
        {(fieldMeta) => (
          <ErrorSummary errors={collectErrorSummary(fieldMeta, FIELD_IDS)} />
        )}
      </form.Subscribe>
      <div className="kit-fields">
        <form.Field name="slug">
          {(field) => (
            <Field
              id={FIELD_IDS.slug.fieldId}
              label="Short link"
              hint="Appears after go/."
              error={fieldErrorMessage(field.state.meta)}
            >
              {(control) => (
                <InputAddon
                  {...control}
                  prefix="go/"
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                />
              )}
            </Field>
          )}
        </form.Field>
        <form.Field name="target">
          {(field) => (
            <Field
              id={FIELD_IDS.target.fieldId}
              label="Target URL"
              error={fieldErrorMessage(field.state.meta)}
            >
              {(control) => (
                <input
                  {...control}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                />
              )}
            </Field>
          )}
        </form.Field>
        <form.Field name="notes">
          {(field) => (
            <Field
              id={FIELD_IDS.notes.fieldId}
              label="Notes"
              hint="Optional."
              error={fieldErrorMessage(field.state.meta)}
            >
              {(control) => (
                <Textarea
                  {...control}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                />
              )}
            </Field>
          )}
        </form.Field>
        <Fieldset
          legend="When it breaks"
          hint="How loudly Hub reports a dead link."
        >
          <form.Field name="severity">
            {(field) => (
              <RadioGroup
                label="Severity"
                name={field.name}
                value={field.state.value}
                onValueChange={(value) => {
                  if (value === "warning" || value === "page") {
                    field.handleChange(value);
                  }
                }}
                options={[
                  {
                    value: "warning",
                    label: "Warn me",
                    hint: "A banner in Hub",
                  },
                  { value: "page", label: "Page me", hint: "Wakes you up" },
                ]}
              />
            )}
          </form.Field>
        </Fieldset>
        <Fieldset legend="Options">
          <form.Field name="public">
            {(field) => (
              <Checkbox
                label="Visible outside the tailnet"
                checked={field.state.value}
                onCheckedChange={(checked) => {
                  field.handleChange(checked);
                }}
              />
            )}
          </form.Field>
          <form.Field name="notify">
            {(field) => (
              <Switch
                label="Notify on every click"
                hint="Turns on at once; no Save needed."
                checked={field.state.value}
                onCheckedChange={(checked) => {
                  field.handleChange(checked);
                }}
              />
            )}
          </form.Field>
        </Fieldset>
      </div>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <FormActions
            submit="Save link"
            pending={pending}
            cancel={<Button type="reset">Cancel</Button>}
            status={<SavedStatus saved={saved} />}
          />
        )}
      </form.Subscribe>
    </form>
  );
}
