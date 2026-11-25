import { Dialog } from "@base-ui/react/dialog";
import { Button, Field } from "@shepherdjerred/console-ui";
import { useState, type SyntheticEvent } from "react";
import {
  ProjectSlugSchema,
  type CreateProjectInput,
} from "#shared/contract.ts";

export function NewProjectDialog({
  open,
  isSubmitting,
  errorMessage,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
  readonly onOpenChange: (next: boolean) => void;
  readonly onSubmit: (input: CreateProjectInput) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [retention, setRetention] = useState("50");
  const [alertOnNewIssue, setAlertOnNewIssue] = useState(true);
  const [alertOnRegression, setAlertOnRegression] = useState(true);
  const [validationError, setValidationError] = useState<string | undefined>(
    undefined,
  );

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setValidationError("Enter a project name.");
      return;
    }
    const trimmedSlug = slug.trim();
    if (trimmedSlug.length > 0) {
      const parsedSlug = ProjectSlugSchema.safeParse(trimmedSlug);
      if (!parsedSlug.success) {
        setValidationError(
          "Slug must use lowercase letters, digits, hyphens, or underscores.",
        );
        return;
      }
    }
    const parsedRetention = Number.parseInt(retention, 10);
    const boundedRetention =
      Number.isFinite(parsedRetention) &&
      parsedRetention >= 1 &&
      parsedRetention <= 1000
        ? parsedRetention
        : 50;

    setValidationError(undefined);
    onSubmit({
      name: trimmedName,
      ...(trimmedSlug.length > 0 ? { slug: trimmedSlug } : {}),
      alertOnNewIssue,
      alertOnRegression,
      retentionMaxEvents: boundedRetention,
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="er-dialog-backdrop" />
        <Dialog.Popup className="er-dialog">
          <div>
            <Dialog.Title className="er-dialog-title">New project</Dialog.Title>
            <Dialog.Description className="er-dialog-desc">
              Generates a Sentry-compatible public DSN on logging.sjer.red.
            </Dialog.Description>
          </div>
          {errorMessage === null ? null : (
            <div className="er-banner" data-sev="error" role="alert">
              <span>{errorMessage}</span>
            </div>
          )}
          <form className="er-dialog-form" onSubmit={handleSubmit}>
            <Field
              label="Project name"
              {...(validationError === undefined
                ? {}
                : { error: validationError })}
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={name}
                  placeholder="Scout Web"
                  maxLength={255}
                  onChange={(event) => {
                    setName(event.currentTarget.value);
                  }}
                />
              )}
            </Field>
            <Field
              label="Slug (optional)"
              hint="Lowercase letters, digits, hyphens, underscores"
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  className={`${control.className} ui-mono`}
                  value={slug}
                  placeholder="scout-web"
                  maxLength={50}
                  onChange={(event) => {
                    setSlug(event.currentTarget.value);
                  }}
                />
              )}
            </Field>
            <Field label="Max retained events per issue">
              {(control) => (
                <input
                  {...control}
                  type="number"
                  min={1}
                  max={1000}
                  value={retention}
                  onChange={(event) => {
                    setRetention(event.currentTarget.value);
                  }}
                />
              )}
            </Field>
            <div className="er-policy-group">
              <label className="er-toggle-label">
                <input
                  type="checkbox"
                  className="er-checkbox"
                  checked={alertOnNewIssue}
                  onChange={(event) => {
                    setAlertOnNewIssue(event.currentTarget.checked);
                  }}
                />
                Alert on new issue
              </label>
              <label className="er-toggle-label">
                <input
                  type="checkbox"
                  className="er-checkbox"
                  checked={alertOnRegression}
                  onChange={(event) => {
                    setAlertOnRegression(event.currentTarget.checked);
                  }}
                />
                Alert on regression
              </label>
            </div>
            <div className="er-dialog-actions">
              <Dialog.Close className="ui-btn" data-variant="default">
                Cancel
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create project"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
