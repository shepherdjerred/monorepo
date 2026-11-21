import { useRef, useState, type SubmitEvent } from "react";
import { z } from "zod";
import type {
  BooleanFlagValue,
  FlagValue,
  VariantFlagValue,
} from "@shepherdjerred/feature-flags/evaluate.ts";
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
}: {
  catalog: string;
  stage: string;
  flagKey: string;
  document: DeploymentDocument;
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

  function onDialogClose() {
    const dialog = dialogRef.current;
    if (dialog === null || draft === undefined) return;
    const value = dialog.returnValue;
    dialog.returnValue = "";
    if (value !== "save" || saving.current) return;
    void save(draft);
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
    <section className="detail" aria-labelledby="flag-heading">
      <h2 id="flag-heading">{flagKey}</h2>
      <p className="muted">Revision {revision}</p>
      <form onSubmit={review}>
        {draft.type === "boolean" ? (
          <BooleanFields flag={draft} onChange={setDraft} />
        ) : (
          <VariantFields flag={draft} onChange={setDraft} />
        )}
        <button type="submit">Review save</button>
      </form>
      {error === undefined ? null : (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {saved ? <p>Saved.</p> : null}
      {conflict === undefined ? null : (
        <section className="conflict" aria-labelledby="conflict-title">
          <h3 id="conflict-title">Revision conflict</h3>
          <p>
            Another write landed at revision {conflict.revision}. This save was
            not applied.
          </p>
          <h4>Their flag</h4>
          <pre>
            {conflict.flag === undefined
              ? "This flag is gone from their document."
              : flagText(conflict.flag)}
          </pre>
          <h4>Your draft</h4>
          <pre>{flagText(draft)}</pre>
          {conflict.flag === undefined ? null : (
            <button type="button" onClick={loadTheirs}>
              Load their version
            </button>
          )}
        </section>
      )}
      <dialog
        ref={dialogRef}
        aria-labelledby="save-title"
        onClose={onDialogClose}
      >
        <h2 id="save-title">Save {flagKey}</h2>
        <div className="compare">
          <section>
            <h3>Before</h3>
            <pre>{flagText(baseFlag)}</pre>
          </section>
          <section>
            <h3>After</h3>
            <pre>{flagText(draft)}</pre>
          </section>
        </div>
        <form method="dialog">
          <button type="submit" value="cancel">
            Cancel
          </button>
          <button type="submit" value="save">
            Save
          </button>
        </form>
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
      <fieldset>
        <legend>Default</legend>
        <label>
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
      <fieldset>
        <legend>Segments</legend>
        {flag.rollouts.map((rollout, rolloutIndex) => (
          <fieldset key={rolloutIndex}>
            <legend>Segment {rolloutIndex + 1}</legend>
            {rollout.constraints.map((constraint, constraintIndex) => (
              <div className="constraint" key={constraintIndex}>
                <label>
                  Property
                  <input
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
                </label>
                <label>
                  Value
                  <input
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
                </label>
                <button
                  type="button"
                  disabled={rollout.constraints.length === 1}
                  onClick={() => {
                    onChange(
                      removeConstraint(flag, rolloutIndex, constraintIndex),
                    );
                  }}
                >
                  Remove constraint
                </button>
              </div>
            ))}
            <label>
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
            <button
              type="button"
              onClick={() => {
                onChange(addConstraint(flag, rolloutIndex));
              }}
            >
              Add constraint
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(removeSegment(flag, rolloutIndex));
              }}
            >
              Remove segment
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() => {
            onChange(addSegment(flag));
          }}
        >
          Add segment
        </button>
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
    <label>
      Value
      <input
        value={flag.value}
        onChange={(event) => {
          onChange(setVariantValue(flag, event.target.value));
        }}
      />
    </label>
  );
}
