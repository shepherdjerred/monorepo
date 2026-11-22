import { useRef, useState, type SubmitEvent } from "react";
import { ArrowLeftIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { z } from "zod";
import { Button, Chip, Field, IconButton } from "@shepherdjerred/console-ui";
import type {
  BooleanFlagValue,
  FlagValue,
  VariantFlagValue,
} from "@shepherdjerred/feature-flags/evaluate.ts";
import { ConflictBanner } from "./conflict-banner.tsx";
import { useApplyFlag, type DeploymentDocument } from "./api.ts";
import {
  addConstraint,
  addSegment,
  draftError,
  flagText,
  removeConstraint,
  removeSegment,
  sameFlag,
  setBooleanDefault,
  setConstraintField,
  setSegmentResult,
  setVariantValue,
} from "./model.ts";

export function Editor({
  catalog,
  stage,
  flagKey,
  document,
  backHref,
}: {
  catalog: string;
  stage: string;
  flagKey: string;
  document: DeploymentDocument;
  backHref: string;
}) {
  const stored = document.flags.find((flag) => flag.key === flagKey);
  const [draft, setDraft] = useState<FlagValue | undefined>(stored);
  const [baseFlag, setBaseFlag] = useState<FlagValue | undefined>(stored);
  const [revision, setRevision] = useState(document.revision);
  const [error, setError] = useState<string | undefined>(undefined);
  const [conflict, setConflict] = useState<
    | { readonly revision: number; readonly flag: FlagValue | undefined }
    | undefined
  >(undefined);
  const [saved, setSaved] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const apply = useApplyFlag(catalog, stage);

  if (stored === undefined || draft === undefined || baseFlag === undefined) {
    return <p role="alert">FLAG_NOT_FOUND</p>;
  }
  if (draft.type !== stored.type || baseFlag.type !== stored.type) {
    return <p role="alert">Stored flag {flagKey} changed type.</p>;
  }

  function review(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft === undefined) return;
    const problem = draftError(draft);
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    if (baseFlag !== undefined && sameFlag(draft, baseFlag)) {
      setError("Nothing to save");
      return;
    }
    setError(undefined);
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }

  function confirmSave() {
    dialogRef.current?.close();
    if (draft === undefined || saving.current) return;
    void save(draft);
  }

  function cancelReview() {
    dialogRef.current?.close();
  }

  async function save(flag: FlagValue) {
    saving.current = true;
    try {
      const result = await apply.mutateAsync({
        expectedRevision: revision,
        flag,
      });
      if (result.kind === "conflict") {
        setSaved(false);
        setConflict({
          revision: result.revision,
          flag: result.flags.find((candidate) => candidate.key === flag.key),
        });
        return;
      }
      setConflict(undefined);
      setRevision(result.revision);
      setBaseFlag(flag);
      setSaved(true);
    } catch (error_: unknown) {
      const parsed = z.object({ message: z.string() }).safeParse(error_);
      setError(parsed.success ? parsed.data.message : "Save failed");
    } finally {
      saving.current = false;
    }
  }

  function loadTheirs() {
    if (conflict?.flag === undefined) return;
    setDraft(conflict.flag);
    setBaseFlag(conflict.flag);
    setRevision(conflict.revision);
    setConflict(undefined);
    setSaved(false);
    setError(undefined);
  }

  return (
    <section className="fl-detail" aria-labelledby="flag-heading">
      <div className="fl-detail-head">
        <a className="fl-back" href={backHref}>
          <ArrowLeftIcon aria-hidden="true" />
          All flags
        </a>
        <h2 id="flag-heading" className="ui-mono fl-detail-title">
          {flagKey}
        </h2>
        <p className="ui-muted">
          {draft.type} flag · Revision {revision}
        </p>
      </div>
      {conflict === undefined ? null : (
        <ConflictBanner
          revision={conflict.revision}
          theirs={conflict.flag}
          draft={draft}
          onLoadTheirs={loadTheirs}
        />
      )}
      <form className="fl-form" onSubmit={review}>
        {draft.type === "boolean" ? (
          <BooleanFields flag={draft} onChange={setDraft} />
        ) : (
          <VariantFields flag={draft} onChange={setDraft} />
        )}
        {error === undefined ? null : (
          <p role="alert" className="ui-field-error">
            {error}
          </p>
        )}
        {saved ? (
          <p role="status" className="ui-muted">
            Saved.
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary">
            Review save
          </Button>
        </div>
      </form>
      <dialog
        ref={dialogRef}
        className="fl-dialog"
        aria-labelledby="save-title"
      >
        <h2 id="save-title" className="fl-dialog-title">
          Save <span className="ui-mono">{flagKey}</span>
        </h2>
        <div className="fl-compare">
          <section aria-labelledby="save-before">
            <h3 id="save-before">Before</h3>
            <pre>{flagText(baseFlag)}</pre>
          </section>
          <section aria-labelledby="save-after">
            <h3 id="save-after">After</h3>
            <pre>{flagText(draft)}</pre>
          </section>
        </div>
        <div className="fl-dialog-actions">
          <Button type="button" value="cancel" onClick={cancelReview}>
            Cancel
          </Button>
          <Button
            type="button"
            value="save"
            variant="primary"
            onClick={confirmSave}
          >
            Save
          </Button>
        </div>
      </dialog>
    </section>
  );
}

function BooleanFields({
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

function VariantFields({
  flag,
  onChange,
}: {
  flag: VariantFlagValue;
  onChange: (flag: VariantFlagValue) => void;
}) {
  return (
    <Field label="Value">
      {(control) => (
        <input
          {...control}
          value={flag.value}
          onChange={(event) => {
            onChange(setVariantValue(flag, event.target.value));
          }}
        />
      )}
    </Field>
  );
}
