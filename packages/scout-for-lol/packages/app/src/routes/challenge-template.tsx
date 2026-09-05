import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import {
  FormPendingStatus,
  ServerFormError,
  focusFirstInvalid,
  handleFormSubmit,
  submitThenChangeValidation,
  useScoutForm,
} from "#src/components/semantic-form.tsx";
import { ChallengeAccountSelection } from "#src/components/challenge-account-selection.tsx";
import { useChallengeTemplateParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/trpc.ts";

const StartRunFormSchema = z
  .strictObject({
    accountIds: z.array(z.number().int().positive()).min(1),
    mode: z.enum(["clean_slate", "earliest_known", "import"]),
    startDate: z.string(),
  })
  .superRefine((value, context) => {
    if (value.mode === "import" && value.startDate.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "Choose an import date",
      });
    }
  });

const RUN_MODES = [
  { value: "clean_slate", label: "Clean slate from now" },
  { value: "earliest_known", label: "Import all Scout-known history" },
  { value: "import", label: "Import since a date" },
] as const;

function emptyStartRunForm(): z.input<typeof StartRunFormSchema> {
  return { accountIds: [], mode: "clean_slate", startDate: "" };
}

export function ChallengeTemplate() {
  const { templateId } = useChallengeTemplateParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const formElement = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery(trpc.challenge.detail.queryOptions({ templateId }));
  const accounts = useQuery(trpc.challenge.linkedAccounts.queryOptions());
  const start = useMutation(
    trpc.challenge.startRun.mutationOptions({
      onSuccess: (result) => {
        form.reset();
        void navigate(`/challenge-runs/${result.runId}`);
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );
  const form = useScoutForm({
    defaultValues: emptyStartRunForm(),
    validationLogic: submitThenChangeValidation,
    validators: { onDynamic: StartRunFormSchema },
    onSubmit: ({ value }) => {
      const parsed = StartRunFormSchema.parse(value);
      const mode =
        parsed.mode === "import"
          ? {
              kind: "import" as const,
              startAt: new Date(`${parsed.startDate}T00:00:00`),
            }
          : { kind: parsed.mode };
      const templateVersion = detail.data?.[0];
      if (templateVersion === undefined) {
        throw new Error("Challenge template version is unavailable");
      }
      start.mutate({
        templateId,
        templateVersionId: templateVersion.id,
        accountIds: parsed.accountIds,
        mode,
      });
    },
    onSubmitInvalid: () => {
      focusFirstInvalid(formElement.current);
    },
  });

  if (detail.isPending || accounts.isPending)
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-scout-subtle">
        Loading challenge…
      </div>
    );
  if (detail.isError || accounts.isError)
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-scout-danger">
        {detail.error?.message ?? accounts.error?.message}
      </div>
    );
  const latest = detail.data[0];
  if (latest === undefined)
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">Challenge not found.</div>
    );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:py-12">
      <Link
        className="text-sm text-scout-subtle hover:underline"
        to="/challenges"
      >
        ← Challenge catalog
      </Link>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {latest.contract.title}
        </h1>
        <p className="text-lg text-scout-subtle">{latest.contract.summary}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {latest.contract.explanation.map((rule, index) => (
            <li key={`${index.toString()}:${rule}`}>{rule}</li>
          ))}
        </ul>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Start a run</CardTitle>
          <CardDescription>
            One active run is kept per challenge. Starting again archives your
            previous run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            ref={formElement}
            className="space-y-5"
            onSubmit={(event) => {
              handleFormSubmit(event, () => form.handleSubmit());
            }}
          >
            <fieldset disabled={start.isPending} className="space-y-5">
              <form.Field name="accountIds">
                {(field) => (
                  <fieldset className="space-y-2">
                    <legend className="font-medium">Riot accounts</legend>
                    <ChallengeAccountSelection
                      accounts={accounts.data}
                      name={field.name}
                      value={field.state.value}
                      onChange={field.handleChange}
                    />
                  </fieldset>
                )}
              </form.Field>
              <form.Field name="mode">
                {(field) => (
                  <fieldset className="space-y-2">
                    <legend className="font-medium">Starting evidence</legend>
                    {RUN_MODES.map(({ value, label }) => (
                      <label
                        className="flex items-center gap-2 text-sm"
                        key={value}
                      >
                        <input
                          type="radio"
                          name={field.name}
                          value={value}
                          checked={field.state.value === value}
                          onChange={() => {
                            field.handleChange(value);
                          }}
                        />{" "}
                        {label}
                      </label>
                    ))}
                  </fieldset>
                )}
              </form.Field>
              <form.Subscribe selector={(state) => state.values.mode}>
                {(mode) =>
                  mode === "import" ? (
                    <form.Field name="startDate">
                      {(field) => (
                        <label
                          className="grid max-w-xs gap-1 text-sm"
                          htmlFor="challenge-import-date"
                        >
                          <span className="font-medium">Import since</span>
                          <input
                            className="scout-control"
                            id="challenge-import-date"
                            name={field.name}
                            type="date"
                            required
                            value={field.state.value}
                            max={new Date().toISOString().slice(0, 10)}
                            onChange={(event) => {
                              field.handleChange(event.currentTarget.value);
                            }}
                          />
                        </label>
                      )}
                    </form.Field>
                  ) : null
                }
              </form.Subscribe>
            </fieldset>
            <ServerFormError error={error} />
            <FormPendingStatus pending={start.isPending}>
              Starting challenge run…
            </FormPendingStatus>
            <Button
              type="submit"
              disabled={start.isPending || accounts.data.length === 0}
            >
              Start run
            </Button>
          </form>
        </CardContent>
      </Card>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Version history</h2>
        <ul className="text-sm text-scout-subtle">
          {detail.data.map((version) => (
            <li key={version.id}>
              Version {version.version.toString()} ·{" "}
              {new Date(version.publishedAt).toLocaleDateString()}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
