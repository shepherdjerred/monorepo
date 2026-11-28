import { useState } from "react";

import type {
  Experiment,
  ExperimentLink,
  ExperimentReviewOutcome,
  FlagChange,
} from "@shepherdjerred/experiments/contract";
import { TextArea, TextInput, fieldText } from "./fields.tsx";
import { DECISIONS } from "./presentation.tsx";

const LINK_TYPES = [
  { value: "tracker", label: "Tracker issue" },
  { value: "flag", label: "Flag" },
  { value: "url", label: "URL" },
] as const;

export function LinkFields() {
  const [kind, setKind] = useState<ExperimentLink["kind"]>("tracker");
  return (
    <fieldset className="experiments-form-fields">
      <legend>Reference</legend>
      <div className="experiments-choices">
        {LINK_TYPES.map(({ value, label }) => (
          <label key={value}>
            <input
              type="radio"
              name="linkKind"
              value={value}
              checked={kind === value}
              onChange={() => {
                setKind(value);
              }}
            />
            {label}
          </label>
        ))}
      </div>
      {kind === "tracker" && (
        <TextInput
          label="Tracker issue ID"
          name="issue"
          hint="Use the team key and issue number, for example AI-123."
          required
          pattern="[A-Za-z][A-Za-z0-9]*-[1-9][0-9]*"
          maxLength={32}
          autoCapitalize="characters"
          spellCheck={false}
        />
      )}
      {kind === "flag" && <FlagFields />}
      {kind === "url" && (
        <>
          <TextInput label="Link label" name="label" required maxLength={200} />
          <TextInput
            label="Link URL"
            name="url"
            type="url"
            hint="Use an HTTP or HTTPS URL."
            required
            maxLength={2048}
            pattern="https?://.+"
            spellCheck={false}
          />
        </>
      )}
    </fieldset>
  );
}

function FlagFields({ prefix = "" }: { readonly prefix?: string }) {
  return (
    <>
      <TextInput
        label="Flag deployment"
        name={prefix + "deployment"}
        hint="Use the catalog and stage shown in Flags, for example toolkit/prod."
        required
        maxLength={150}
        spellCheck={false}
      />
      <TextInput
        label="Flag key"
        name={prefix + "key"}
        required
        maxLength={150}
        spellCheck={false}
      />
    </>
  );
}

export function readLink(form: FormData): ExperimentLink | undefined {
  switch (fieldText(form, "linkKind")) {
    case "tracker":
      return { kind: "tracker", issue: fieldText(form, "issue").toUpperCase() };
    case "flag":
      return {
        kind: "flag",
        deployment: fieldText(form, "deployment"),
        key: fieldText(form, "key"),
      };
    case "url":
      return {
        kind: "url",
        label: fieldText(form, "label"),
        url: fieldText(form, "url"),
      };
    default:
      return undefined;
  }
}

export function EvidenceFields() {
  const [withLink, setWithLink] = useState(false);
  const [withFlagChange, setWithFlagChange] = useState(false);
  return (
    <>
      <TextArea label="Observation" name="note" required />
      <label className="experiments-choice">
        <input
          name="includeLink"
          type="checkbox"
          checked={withLink}
          onChange={(event) => {
            setWithLink(event.currentTarget.checked);
          }}
        />
        Include a reference
      </label>
      {withLink && <LinkFields />}
      <label className="experiments-choice">
        <input
          name="includeFlagChange"
          type="checkbox"
          checked={withFlagChange}
          onChange={(event) => {
            setWithFlagChange(event.currentTarget.checked);
          }}
        />
        Record an observed flag change
      </label>
      {withFlagChange && (
        <fieldset className="experiments-form-fields">
          <legend>Flag change</legend>
          <FlagFields prefix="change-" />
          <TextInput label="Before" name="before" maxLength={8000} />
          <TextInput label="After" name="after" maxLength={8000} />
          <TextInput
            label="Flag revision"
            name="flagRevision"
            type="number"
            min={0}
            step={1}
            required
          />
          <TextInput
            label="Change time (your local time)"
            name="changedAt"
            type="datetime-local"
            required
          />
        </fieldset>
      )}
    </>
  );
}

export function readFlagChange(form: FormData): FlagChange | undefined {
  if (!form.has("includeFlagChange")) return undefined;
  return {
    deployment: fieldText(form, "change-deployment"),
    key: fieldText(form, "change-key"),
    before: fieldText(form, "before"),
    after: fieldText(form, "after"),
    revision: Number(fieldText(form, "flagRevision")),
    changedAt: new Date(fieldText(form, "changedAt")).toISOString(),
  };
}

const OUTCOMES = ["keep", "revert", "inconclusive", "extend"] as const;

export function ReviewFields({
  experiment,
}: {
  readonly experiment: Experiment;
}) {
  const [outcome, setOutcome] = useState<ExperimentReviewOutcome>();
  return (
    <>
      <fieldset className="experiments-form-fields">
        <legend>Outcome</legend>
        <div className="experiments-choices">
          {OUTCOMES.map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="outcome"
                value={value}
                checked={outcome === value}
                onChange={() => {
                  setOutcome(value);
                }}
                required
              />
              {DECISIONS[value]}
            </label>
          ))}
        </div>
      </fieldset>
      {outcome === "extend" && (
        <TextInput
          label="New review date"
          name="reviewDate"
          type="date"
          hint={
            experiment.reviewDate === null
              ? undefined
              : `Choose a date after ${experiment.reviewDate}.`
          }
          required
        />
      )}
      <TextArea label="Rationale" name="rationale" required />
    </>
  );
}
