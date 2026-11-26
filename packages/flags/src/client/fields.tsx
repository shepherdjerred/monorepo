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

/**
 * The stored string in a typed control: a number field for `number`
 * encodings, a wrapping text area for JSON text, a text field otherwise.
 */
export function VariantFields({
  flag,
  kind,
  onChange,
  describedBy,
  invalid,
}: {
  flag: VariantFlagValue;
  kind: ValueKind;
  onChange: (flag: VariantFlagValue) => void;
  describedBy: string | undefined;
  invalid: boolean;
}) {
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
