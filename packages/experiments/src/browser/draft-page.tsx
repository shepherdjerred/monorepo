import { Button, HeaderBar, Section } from "@shepherdjerred/console-ui";
import type { SubmitEvent } from "react";
import { Link, useNavigate } from "react-router";

import type { Experiment } from "@shepherdjerred/experiments/contract";
import { useExperimentMutation } from "./api.ts";
import { PlanFields, TextInput, fieldText, readPlan } from "./fields.tsx";
import {
  EXPERIMENTS_PATH,
  FormError,
  experimentPath,
} from "./presentation.tsx";

export function DraftForm({
  api,
  experiment,
  onSaved,
  onCancel,
}: {
  readonly api: string;
  readonly experiment?: Experiment;
  readonly onSaved?: () => void;
  readonly onCancel?: () => void;
}) {
  const navigate = useNavigate();
  const mutation = useExperimentMutation(api);
  const path =
    experiment === undefined ? "" : "/" + encodeURIComponent(experiment.id);

  function save(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reviewDate = fieldText(form, "reviewDate");
    const fields = {
      title: fieldText(form, "title"),
      owner: fieldText(form, "owner"),
      plan: readPlan(form),
    };
    if (experiment === undefined) {
      mutation.mutate(
        {
          method: "POST",
          body: { ...fields, ...(reviewDate === "" ? {} : { reviewDate }) },
        },
        {
          onSuccess: (record) => {
            void navigate(experimentPath(record.id), { replace: true });
          },
        },
      );
    } else {
      mutation.mutate(
        {
          method: "PATCH",
          path,
          body: {
            ...fields,
            expectedRevision: experiment.revision,
            reviewDate: reviewDate || null,
          },
        },
        {
          onSuccess: () => {
            onSaved?.();
          },
        },
      );
    }
  }

  return (
    <form
      className="experiments-form"
      action={api + path}
      method="post"
      onSubmit={save}
      aria-label="Experiment draft"
    >
      <FormError error={mutation.error} />
      <TextInput
        label="Title"
        name="title"
        required
        maxLength={200}
        defaultValue={experiment?.title}
      />
      <TextInput
        label="Owner"
        name="owner"
        required
        maxLength={200}
        defaultValue={experiment?.owner}
      />
      <TextInput
        label="Review date"
        name="reviewDate"
        type="date"
        hint="The review queue uses Pacific Time."
        defaultValue={experiment?.reviewDate ?? ""}
      />
      <PlanFields
        {...(experiment === undefined ? {} : { plan: experiment.plan })}
      />
      <div className="experiments-actions">
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {experiment === undefined ? "Save draft" : "Save changes"}
        </Button>
        {experiment === undefined && <Link to={EXPERIMENTS_PATH}>Cancel</Link>}
        {onCancel !== undefined && (
          <Button
            type="button"
            onClick={onCancel}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
        )}
        {mutation.isSuccess && <span role="status">Draft saved.</span>}
      </div>
    </form>
  );
}

export function NewExperimentPage({ api }: { readonly api: string }) {
  return (
    <main id="main" className="experiments-page">
      <HeaderBar title="New experiment" focusOnMount />
      <Section title="Draft experiment">
        <div className="ui-section-body">
          <p>
            Write down the change you want to try and how you’ll decide whether
            it worked.
          </p>
          <DraftForm api={api} />
        </div>
      </Section>
    </main>
  );
}
