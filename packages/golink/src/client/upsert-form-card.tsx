import type { RefCallback, RefObject } from "react";
import { SHORT_SLUG_PATTERN, type DynamicLinkKind } from "#shared/contract.ts";
import { describeDynamicKind } from "./directory-sections.tsx";
import {
  syncShortInputValidity,
  syncTargetInputValidity,
} from "./validation.ts";

export type FormMode =
  | { kind: "create" }
  | { kind: "edit"; short: string }
  | {
      kind: "override";
      short: string;
      dynamicKind: DynamicLinkKind;
      previousTargetUrl: string;
    };

function describeFormHeading(mode: FormMode): string {
  switch (mode.kind) {
    case "create": {
      return "Create or Override Shortlink";
    }
    case "edit": {
      return `Edit Manual Shortlink go/${mode.short}`;
    }
    case "override": {
      return `Override ${describeDynamicKind(mode.dynamicKind)} go/${mode.short}`;
    }
  }
}

export function MissingSlugBanner({
  slug,
  onDismiss,
}: {
  slug: string;
  onDismiss: () => void;
}) {
  return (
    <div className="missing-banner" role="status">
      <div className="missing-banner-text">
        <span className="missing-badge" aria-hidden="true">
          go/{slug}
        </span>
        <span>
          <code>go/{slug}</code> does not exist yet — create a manual link below
        </span>
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-row"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

export function UpsertFormCard({
  formMode,
  writesEnabled,
  shortValue,
  targetValue,
  shortErrorText,
  targetErrorText,
  isSubmitting,
  showCancelButton,
  mutationError,
  statusMessage,
  formRef,
  shortInputRef,
  targetRefCallback,
  onShortValueChange,
  onTargetValueChange,
  onShortErrorChange,
  onTargetErrorChange,
  onSubmit,
  onCancel,
}: {
  formMode: FormMode;
  writesEnabled: boolean;
  shortValue: string;
  targetValue: string;
  shortErrorText: string;
  targetErrorText: string;
  isSubmitting: boolean;
  showCancelButton: boolean;
  mutationError: string | null;
  statusMessage: string | null;
  formRef: RefCallback<HTMLFormElement>;
  shortInputRef: RefObject<HTMLInputElement | null>;
  targetRefCallback: RefCallback<HTMLInputElement>;
  onShortValueChange: (value: string) => void;
  onTargetValueChange: (value: string) => void;
  onShortErrorChange: (message: string) => void;
  onTargetErrorChange: (message: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="upsert-card" aria-labelledby="upsert-form-heading">
      <div className="upsert-card-header">
        <h2 id="upsert-form-heading">{describeFormHeading(formMode)}</h2>
        {formMode.kind === "override" && (
          <p className="override-context">
            Currently resolves via{" "}
            <strong>{describeDynamicKind(formMode.dynamicKind)}</strong> to{" "}
            <code>{formMode.previousTargetUrl}</code>
          </p>
        )}
      </div>

      {!writesEnabled && (
        <p className="readonly-notice">
          Manual shortlink creation and edits are currently disabled in
          configuration.
        </p>
      )}

      <form
        ref={formRef}
        method="post"
        action="/api/links"
        className="upsert-form"
        aria-labelledby="upsert-form-heading"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="upsert-fields-grid">
          <div className="field">
            <label htmlFor="short-input">
              Shortlink name{" "}
              <span className="required-mark" aria-hidden="true">
                *
              </span>
            </label>
            <span id="short-hint" className="hint">
              1–64 letters, numbers, dots, hyphens, or underscores.
            </span>
            <div className="slug-input-shell">
              <span className="slug-prefix" aria-hidden="true">
                go/
              </span>
              <input
                ref={shortInputRef}
                id="short-input"
                name="short"
                type="text"
                required
                pattern={SHORT_SLUG_PATTERN}
                maxLength={64}
                placeholder="grafana"
                value={shortValue}
                disabled={!writesEnabled}
                readOnly={formMode.kind !== "create"}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="next"
                aria-describedby="short-hint"
                data-error="short-error"
                onChange={(event) => {
                  onShortValueChange(event.target.value);
                  onShortErrorChange(syncShortInputValidity(event.target));
                }}
                onBlur={(event) => {
                  onShortErrorChange(syncShortInputValidity(event.target));
                }}
              />
            </div>
            <div id="short-error" className="error-msg">
              <span role="img" aria-label="Error">
                ⚠
              </span>{" "}
              <span>{shortErrorText}</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="target-input">
              Destination URL{" "}
              <span className="required-mark" aria-hidden="true">
                *
              </span>
            </label>
            <span id="target-hint" className="hint">
              Full https:// or http:// target address.
            </span>
            <input
              ref={targetRefCallback}
              id="target-input"
              name="targetUrl"
              type="url"
              required
              placeholder="https://grafana.tailnet-1a49.ts.net"
              value={targetValue}
              disabled={!writesEnabled}
              autoComplete="url"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="done"
              aria-describedby="target-hint"
              data-error="target-error"
              onChange={(event) => {
                onTargetValueChange(event.target.value);
                onTargetErrorChange(syncTargetInputValidity(event.target));
              }}
              onBlur={(event) => {
                onTargetErrorChange(syncTargetInputValidity(event.target));
              }}
            />
            <div id="target-error" className="error-msg">
              <span role="img" aria-label="Error">
                ⚠
              </span>{" "}
              <span>{targetErrorText}</span>
            </div>
          </div>
        </div>

        <div className="upsert-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!writesEnabled || isSubmitting}
          >
            {isSubmitting ? "Saving…" : "Save link"}
          </button>
          {showCancelButton && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {mutationError !== null && (
        <div className="feedback-banner feedback-error" role="alert">
          <span role="img" aria-label="Error">
            ⚠
          </span>{" "}
          <span>{mutationError}</span>
        </div>
      )}

      <div
        role="status"
        aria-live="polite"
        className={
          statusMessage === null
            ? "visually-hidden"
            : "feedback-banner feedback-success"
        }
      >
        {statusMessage ?? ""}
      </div>
    </section>
  );
}
