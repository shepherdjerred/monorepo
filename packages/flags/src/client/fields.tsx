import { useId, useRef, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button, Chip, Field, IconButton } from "@shepherdjerred/console-ui";
import type {
  BooleanFlagValue,
  VariantFlagValue,
} from "@shepherdjerred/feature-flags/evaluate.ts";
import {
  addConstraint,
  addSegment,
  removeConstraint,
  removeSegment,
  setBooleanDefault,
  setConstraintField,
  setSegmentResult,
  setVariantValue,
  type ValueKind,
} from "./model.ts";
import {
  modelValueNotice,
  type ModelStatus,
  type ValueChoice,
  type ValueChoices,
} from "./value-choices.ts";

/*
 * The Form mode's controls: a boolean flag's default and segments, and a
 * variant's stored string in a control that fits its encoding.
 */

export function BooleanFields({
  flag,
  onChange,
}: {
  flag: BooleanFlagValue;
  onChange: (flag: BooleanFlagValue) => void;
}) {
  return (
    <>
      <fieldset className="fl-group">
        <legend>Default</legend>
        <label className="fl-check">
          <input
            type="checkbox"
            checked={flag.default}
            onChange={(event) => {
              onChange(setBooleanDefault(flag, event.target.checked));
            }}
          />
          On when no segment matches
        </label>
      </fieldset>
      <fieldset className="fl-group">
        <legend>Segments</legend>
        {flag.rollouts.length === 0 ? (
          <p className="ui-muted">No segments.</p>
        ) : null}
        {flag.rollouts.map((rollout, rolloutIndex) => (
          <fieldset className="fl-segment" key={rolloutIndex}>
            <legend>Segment {rolloutIndex + 1}</legend>
            <p className="fl-chips" aria-label="Constraints">
              {rollout.constraints.map((constraint, constraintIndex) => (
                <Chip
                  key={constraintIndex}
                  label={constraint.property || "…"}
                  value={constraint.value || "…"}
                />
              ))}
            </p>
            {rollout.constraints.map((constraint, constraintIndex) => (
              <div className="fl-constraint" key={constraintIndex}>
                <Field label="Property">
                  {(control) => (
                    <input
                      {...control}
                      value={constraint.property}
                      required
                      onChange={(event) => {
                        onChange(
                          setConstraintField(flag, {
                            rolloutIndex,
                            constraintIndex,
                            field: "property",
                            value: event.target.value,
                          }),
                        );
                      }}
                    />
                  )}
                </Field>
                <Field label="Value">
                  {(control) => (
                    <input
                      {...control}
                      value={constraint.value}
                      required
                      onChange={(event) => {
                        onChange(
                          setConstraintField(flag, {
                            rolloutIndex,
                            constraintIndex,
                            field: "value",
                            value: event.target.value,
                          }),
                        );
                      }}
                    />
                  )}
                </Field>
                <IconButton
                  icon={Trash2Icon}
                  label={`Remove constraint ${String(constraintIndex + 1)} of segment ${String(rolloutIndex + 1)}`}
                  disabled={rollout.constraints.length === 1}
                  onClick={() => {
                    onChange(
                      removeConstraint(flag, rolloutIndex, constraintIndex),
                    );
                  }}
                />
              </div>
            ))}
            <label className="fl-check">
              <input
                type="checkbox"
                checked={rollout.result}
                onChange={(event) => {
                  onChange(
                    setSegmentResult(flag, rolloutIndex, event.target.checked),
                  );
                }}
              />
              Segment result is on
            </label>
            <div className="fl-actions">
              <Button
                type="button"
                onClick={() => {
                  onChange(addConstraint(flag, rolloutIndex));
                }}
              >
                <PlusIcon aria-hidden="true" />
                Add constraint
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onChange(removeSegment(flag, rolloutIndex));
                }}
              >
                Remove segment
              </Button>
            </div>
          </fieldset>
        ))}
        <div className="fl-actions">
          <Button
            type="button"
            onClick={() => {
              onChange(addSegment(flag));
            }}
          >
            <PlusIcon aria-hidden="true" />
            Add segment
          </Button>
        </div>
      </fieldset>
    </>
  );
}

type VariantFieldProps = {
  flag: VariantFlagValue;
  onChange: (flag: VariantFlagValue) => void;
  describedBy: string | undefined;
  invalid: boolean;
};

/**
 * The stored string in a typed control: a select for closed choices or
 * catalog models, a number field for `number` encodings, a wrapping text
 * area for JSON text, a text field otherwise.
 */
export function VariantFields({
  kind,
  ...props
}: VariantFieldProps & { kind: ValueKind }) {
  const choices = kind.kind === "managed" ? kind.choices : undefined;
  if (choices === undefined) return <TypedField {...props} kind={kind} />;
  return choices.closed ? (
    <ClosedChoiceField {...props} values={choices.values} />
  ) : (
    <ModelChoiceField {...props} choices={choices} />
  );
}

/** One of the schema's `enum`/`const` values; a stored outsider stays visible. */
function ClosedChoiceField({
  flag,
  onChange,
  describedBy,
  invalid,
  values,
}: VariantFieldProps & { values: readonly ValueChoice[] }) {
  const allowed = values.some((choice) => choice.value === flag.value);
  return (
    <Field label="Value">
      {(control) => (
        <select
          {...control}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          value={flag.value}
          onChange={(event) => {
            onChange(setVariantValue(flag, event.target.value));
          }}
        >
          {allowed ? null : (
            <option value={flag.value}>
              {flag.value === "" ? "(empty)" : flag.value} (not allowed)
            </option>
          )}
          {values.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Whitespace makes this an impossible model id, so it never collides with one. */
const CUSTOM = " custom";

const STATUS_GROUPS: readonly {
  readonly status: ModelStatus;
  readonly label: string;
}[] = [
  { status: "current", label: "Current" },
  { status: "preview", label: "Preview" },
  { status: "deprecated", label: "Deprecated" },
];

/**
 * A catalog model the flag's consumer can route, or "Custom…" with a text
 * field for a model the catalog does not list yet. A stored value outside the
 * list opens on Custom, and a risky value gets a warning.
 */
function ModelChoiceField({
  flag,
  onChange,
  describedBy,
  invalid,
  choices,
}: VariantFieldProps & {
  choices: Extract<ValueChoices, { closed: false }>;
}) {
  const listed = choices.values.some((choice) => choice.value === flag.value);
  // Typing a listed id into the custom field keeps the field, not the select.
  const [customChosen, setCustomChosen] = useState(false);
  const focusCustom = useRef(false);
  const noticeId = useId();
  const custom = customChosen || !listed;
  const notice = modelValueNotice(choices, flag.value);
  const described =
    [describedBy, notice === undefined ? undefined : noticeId]
      .filter((id) => id !== undefined)
      .join(" ") || undefined;
  return (
    <div className="fl-choice">
      <Field label="Model">
        {(control) => (
          <select
            {...control}
            aria-describedby={described}
            aria-invalid={invalid && !custom ? true : undefined}
            value={custom ? CUSTOM : flag.value}
            onChange={(event) => {
              const next = event.target.value;
              if (next === CUSTOM) {
                focusCustom.current = true;
                setCustomChosen(true);
                return;
              }
              setCustomChosen(false);
              onChange(setVariantValue(flag, next));
            }}
          >
            {STATUS_GROUPS.map(({ status, label }) => {
              const group = choices.values.filter(
                (choice) => choice.status === status,
              );
              return group.length === 0 ? null : (
                <optgroup key={status} label={label}>
                  {group.map((choice) => (
                    <option
                      key={choice.value}
                      value={choice.value}
                      title={choice.detail}
                    >
                      {choice.label} · {choice.value}
                    </option>
                  ))}
                </optgroup>
              );
            })}
            <option value={CUSTOM}>Custom…</option>
          </select>
        )}
      </Field>
      {custom ? (
        <Field label="Custom model id">
          {(control) => (
            <input
              {...control}
              ref={(element: HTMLInputElement | null) => {
                if (element === null || !focusCustom.current) return;
                focusCustom.current = false;
                element.focus();
              }}
              aria-describedby={described}
              aria-invalid={invalid ? true : undefined}
              value={flag.value}
              spellCheck={false}
              autoComplete="off"
              className={`${control.className} ui-mono`}
              onChange={(event) => {
                setCustomChosen(true);
                onChange(setVariantValue(flag, event.target.value));
              }}
            />
          )}
        </Field>
      ) : null}
      {notice === undefined ? null : (
        <p id={noticeId} className="fl-notice" data-tone="warning" role="note">
          {notice}
        </p>
      )}
    </div>
  );
}

/** A free-form control that fits the value's encoding. */
function TypedField({
  flag,
  kind,
  onChange,
  describedBy,
  invalid,
}: VariantFieldProps & { kind: ValueKind }) {
  const encoding = kind.kind === "managed" ? kind.encoding : "string";
  const label = encoding === "json" ? "Value (stored JSON text)" : "Value";
  return (
    <Field label={label}>
      {(control) => {
        const props = {
          ...control,
          "aria-describedby": describedBy,
          "aria-invalid": invalid ? true : undefined,
          value: flag.value,
          spellCheck: false,
        };
        if (encoding === "json") {
          return (
            <textarea
              {...props}
              className={`${control.className} fl-textarea ui-mono`}
              rows={4}
              onChange={(event) => {
                onChange(setVariantValue(flag, event.target.value));
              }}
            />
          );
        }
        return (
          <input
            {...props}
            type={encoding === "number" ? "number" : "text"}
            step={encoding === "number" ? "any" : undefined}
            inputMode={encoding === "number" ? "decimal" : undefined}
            autoComplete="off"
            onChange={(event) => {
              onChange(setVariantValue(flag, event.target.value));
            }}
          />
        );
      }}
    </Field>
  );
}
