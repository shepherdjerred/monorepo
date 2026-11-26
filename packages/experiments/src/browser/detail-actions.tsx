import { Button, Card } from "@shepherdjerred/console-ui";
import { useEffect, useRef, type SubmitEvent } from "react";

import type { Experiment } from "@shepherdjerred/experiments/contract";
import {
  EvidenceFields,
  LinkFields,
  ReviewFields,
  readFlagChange,
  readLink,
} from "./action-fields.tsx";
import { useExperimentMutation } from "./api.ts";
import { DraftForm } from "./draft-page.tsx";
import { PlanFields, TextArea, fieldText, readPlan } from "./fields.tsx";
import { FormError } from "./presentation.tsx";

export const ACTIONS = {
  edit: {
    title: "Edit draft",
    submit: "Save changes",
    success: "Draft saved.",
  },
  start: {
    title: "Start experiment",
    submit: "Start experiment",
    success: "Experiment started.",
  },
  amend: {
    title: "Amend plan",
    submit: "Save amendment",
    success: "Amendment saved.",
  },
  link: {
    title: "Add reference",
    submit: "Save reference",
    success: "Reference added.",
  },
  evidence: {
    title: "Add evidence",
    submit: "Save evidence",
    success: "Evidence added.",
  },
  review: {
    title: "Record decision",
    submit: "Save review",
    success: "Review recorded.",
  },
} as const;

export type DetailAction = keyof typeof ACTIONS;

function ActionFields({
  action,
  experiment,
}: {
  readonly action: Exclude<DetailAction, "edit">;
  readonly experiment: Experiment;
}) {
  switch (action) {
    case "start":
      return (
        <p>
          Start the saved draft and keep a copy of the current plan for review.
        </p>
      );
    case "amend":
      return (
        <>
          <TextArea
            label="Why are you changing the plan?"
            name="rationale"
            required
          />
          <PlanFields plan={experiment.plan} />
        </>
      );
    case "link":
      return <LinkFields />;
    case "evidence":
      return <EvidenceFields />;
    case "review":
      return <ReviewFields experiment={experiment} />;
  }
}

function actionPayload(
  action: Exclude<DetailAction, "edit">,
  form: FormData,
): object {
  switch (action) {
    case "start":
      return {};
    case "amend":
      return { rationale: fieldText(form, "rationale"), plan: readPlan(form) };
    case "link":
      return { link: readLink(form) };
    case "evidence": {
      const link = readLink(form);
      const flagChange = readFlagChange(form);
      return {
        note: fieldText(form, "note"),
        ...(link === undefined ? {} : { link }),
        ...(flagChange === undefined ? {} : { flagChange }),
      };
    }
    case "review": {
      const outcome = fieldText(form, "outcome");
      return {
        outcome,
        rationale: fieldText(form, "rationale"),
        ...(outcome === "extend"
          ? { reviewDate: fieldText(form, "reviewDate") }
          : {}),
      };
    }
  }
}

type ActionFormProps = {
  readonly api: string;
  readonly experiment: Experiment;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
};

function ExperimentActionForm({
  api,
  experiment,
  onSaved,
  onCancel,
  action,
}: ActionFormProps & { readonly action: Exclude<DetailAction, "edit"> }) {
  const mutation = useExperimentMutation(api);
  const path = "/" + encodeURIComponent(experiment.id) + "/" + action;

  function save(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate(
      {
        method: "POST",
        path,
        body: {
          expectedRevision: experiment.revision,
          ...actionPayload(action, form),
        },
      },
      { onSuccess: onSaved },
    );
  }

  return (
    <form
      action={api + path}
      method="post"
      onSubmit={save}
      className="experiments-form"
      aria-labelledby="experiment-action"
    >
      <FormError error={mutation.error} />
      <ActionFields action={action} experiment={experiment} />
      <div className="experiments-actions">
        <Button
          type="submit"
          size="page"
          variant="primary"
          disabled={mutation.isPending}
        >
          {ACTIONS[action].submit}
        </Button>
        <Button
          type="button"
          size="page"
          onClick={onCancel}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ActionCard({
  action,
  ...form
}: ActionFormProps & { readonly action: DetailAction }) {
  const title = ACTIONS[action].title;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <Card label={title} className="experiments-section experiments-action-card">
      <h2 id="experiment-action" ref={heading} tabIndex={-1}>
        {title}
      </h2>
      {action === "edit" ? (
        <DraftForm {...form} />
      ) : (
        <ExperimentActionForm action={action} {...form} />
      )}
    </Card>
  );
}
