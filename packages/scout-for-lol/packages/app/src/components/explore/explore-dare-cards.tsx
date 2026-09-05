import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleX, Clock3, FilePenLine } from "lucide-react";
import { z } from "zod";
import type { ExploreTraceEntry } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";
import {
  classifyDareIntentConfirmation,
  type DareIntentConfirmationOutcome,
} from "#src/lib/dares/dare-intent-confirmation.ts";
import { useTRPC } from "#src/lib/trpc.ts";

const DraftDataSchema = z.strictObject({
  dareId: z.number().int().positive(),
  revision: z.number().int().positive(),
  canonicalScoutQl: z.string().min(1),
  plainLanguage: z.string().min(1),
  semanticProofPlan: z.string().min(1),
  openingStake: z.number().int().positive(),
  targetAliases: z.array(z.string()),
  originalText: z.string().min(1).optional(),
  sqlIsBinding: z.boolean().optional(),
});

const IntentDataSchema = z.strictObject({
  intentId: z.uuid(),
  action: z.enum(["fund", "accept", "decline", "contribute", "cancel"]),
  expiresAt: z.iso.datetime(),
  dareId: z.number().int().positive(),
  revision: z.number().int().positive(),
  originalText: z.string().min(1).optional(),
  plainLanguage: z.string().min(1).optional(),
  semanticProofPlan: z.string().min(1).optional(),
  canonicalScoutQl: z.string().min(1).optional(),
  sqlIsBinding: z.boolean().optional(),
});

const DareToolOutputSchema = z.strictObject({
  kind: z.string(),
  message: z.string(),
  data: z.json().nullable(),
});

type DareCard =
  | { kind: "draft"; data: z.infer<typeof DraftDataSchema> }
  | { kind: "intent"; data: z.infer<typeof IntentDataSchema> };

function cardsFromTrace(trace: ExploreTraceEntry[]): DareCard[] {
  const cards: DareCard[] = [];
  for (const entry of trace) {
    if (entry.rawOutput?.kind !== "value") continue;
    const output = DareToolOutputSchema.safeParse(entry.rawOutput.value);
    if (!output.success) continue;
    if (output.data.kind === "created" || output.data.kind === "revised") {
      const draft = DraftDataSchema.safeParse(output.data.data);
      if (draft.success) cards.push({ kind: "draft", data: draft.data });
    }
    if (output.data.kind === "confirmation_required") {
      const intent = IntentDataSchema.safeParse(output.data.data);
      if (intent.success) cards.push({ kind: "intent", data: intent.data });
    }
  }
  return cards;
}

export function ExploreDareCards(props: { trace: ExploreTraceEntry[] }) {
  const cards = useMemo(() => cardsFromTrace(props.trace), [props.trace]);
  if (cards.length === 0) return null;
  return (
    <div className="space-y-3" aria-label="Dare actions">
      {cards.map((card) =>
        card.kind === "draft" ? (
          <DraftCard
            key={`draft-${card.data.dareId.toString()}-${card.data.revision.toString()}`}
            draft={card.data}
          />
        ) : (
          <IntentCard key={card.data.intentId} intent={card.data} />
        ),
      )}
    </div>
  );
}

function DraftCard(props: { draft: z.infer<typeof DraftDataSchema> }) {
  const [showQuery, setShowQuery] = useState(false);
  return (
    <section className="space-y-3 rounded-lg border border-scout-border bg-scout-surface p-4">
      <div className="flex items-center gap-2">
        <FilePenLine className="size-4 text-scout-primary" />
        <h3 className="font-medium">
          Dare #{props.draft.dareId.toString()} draft · revision{" "}
          {props.draft.revision.toString()}
        </h3>
      </div>
      <p className="whitespace-pre-wrap text-sm">{props.draft.plainLanguage}</p>
      {props.draft.originalText !== undefined && (
        <p className="text-xs text-scout-subtle">
          Original wording: {props.draft.originalText}
        </p>
      )}
      <dl className="grid gap-1 text-xs text-scout-subtle sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">Targets: </dt>
          <dd className="inline">{props.draft.targetAliases.join(", ")}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Opening stake: </dt>
          <dd className="inline">{props.draft.openingStake.toString()} BB</dd>
        </div>
      </dl>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setShowQuery((shown) => !shown);
        }}
      >
        {showQuery
          ? `Hide ${props.draft.sqlIsBinding === true ? "binding SQL" : "ScoutQL"}`
          : `Show ${props.draft.sqlIsBinding === true ? "binding SQL" : "ScoutQL"}`}
      </Button>
      {showQuery && (
        <div className="space-y-2">
          {props.draft.sqlIsBinding === true && (
            <p className="text-xs font-medium text-scout-primary">
              This canonical SQL is the binding Dare contract.
            </p>
          )}
          <ScoutQlCode queryText={props.draft.canonicalScoutQl} />
        </div>
      )}
    </section>
  );
}

function persistedConfirmationOutcome(
  action: z.infer<typeof IntentDataSchema>["action"],
  status:
    { state: "consumed" | "expired" | "pending"; result: unknown } | undefined,
): DareIntentConfirmationOutcome | null {
  if (status?.state === "consumed") {
    return classifyDareIntentConfirmation(action, {
      kind: "already_consumed",
      result: status.result,
    });
  }
  if (status?.state === "expired") {
    return classifyDareIntentConfirmation(action, { kind: "intent_expired" });
  }
  return null;
}

function IntentOutcomeIcon(props: {
  outcome: DareIntentConfirmationOutcome | null;
}) {
  if (props.outcome === null) {
    return <Clock3 className="size-4 text-scout-primary" />;
  }
  return props.outcome.status === "confirmed" ? (
    <CheckCircle2 className="size-4 text-scout-primary" />
  ) : (
    <CircleX className="size-4 text-scout-danger" />
  );
}

function intentHeading(
  action: z.infer<typeof IntentDataSchema>["action"],
  outcome: DareIntentConfirmationOutcome | null,
): string {
  if (outcome === null) return `Confirm ${action}`;
  return outcome.status === "confirmed"
    ? "Action confirmed"
    : "Action was not confirmed";
}

function IntentOutcomeMessage(props: {
  outcome: DareIntentConfirmationOutcome;
}) {
  return (
    <p
      className={`text-sm capitalize ${props.outcome.status === "failed" ? "text-scout-danger" : ""}`}
    >
      {props.outcome.message}
    </p>
  );
}

function IntentCard(props: { intent: z.infer<typeof IntentDataSchema> }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<DareIntentConfirmationOutcome | null>(
    null,
  );
  const mutation = useMutation(
    trpc.explore.confirmDareIntent.mutationOptions(),
  );
  const persisted = useQuery(
    trpc.explore.intentStatus.queryOptions({
      intentId: props.intent.intentId,
    }),
  );
  const expires = new Date(props.intent.expiresAt);
  const persistedOutcome = persistedConfirmationOutcome(
    props.intent.action,
    persisted.data,
  );
  const displayedOutcome = outcome ?? persistedOutcome;

  return (
    <section className="space-y-3 rounded-lg border border-scout-primary/40 bg-scout-primary/5 p-4">
      <div className="flex items-center gap-2">
        <IntentOutcomeIcon outcome={displayedOutcome} />
        <h3 className="font-medium">
          {intentHeading(props.intent.action, displayedOutcome)}
        </h3>
      </div>
      <p className="text-sm text-scout-subtle">
        Dare #{props.intent.dareId.toString()}, revision{" "}
        {props.intent.revision.toString()}. This single-use confirmation expires{" "}
        {expires.toLocaleTimeString()}.
      </p>
      {props.intent.originalText !== undefined && (
        <div className="space-y-2 rounded-md border border-scout-border bg-scout-surface p-3 text-sm">
          <p>
            <span className="font-medium">Original wording:</span>{" "}
            {props.intent.originalText}
          </p>
          <p>{props.intent.plainLanguage}</p>
          {props.intent.semanticProofPlan !== undefined && (
            <p className="whitespace-pre-wrap text-xs text-scout-subtle">
              {props.intent.semanticProofPlan}
            </p>
          )}
          {props.intent.sqlIsBinding === true && (
            <p className="text-xs font-medium text-scout-primary">
              The canonical SQL below is the binding contract.
            </p>
          )}
          {props.intent.canonicalScoutQl !== undefined && (
            <ScoutQlCode queryText={props.intent.canonicalScoutQl} />
          )}
        </div>
      )}
      {displayedOutcome === null || displayedOutcome.retryable ? (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={mutation.isPending || expires.getTime() <= Date.now()}
            onClick={() => {
              mutation.mutate(
                { intentId: props.intent.intentId },
                {
                  onSuccess: (result) => {
                    setOutcome(
                      classifyDareIntentConfirmation(
                        props.intent.action,
                        result,
                      ),
                    );
                    void queryClient.invalidateQueries({
                      queryKey: trpc.bucks.dareList.pathKey(),
                    });
                    void queryClient.invalidateQueries({
                      queryKey: trpc.bucks.dareInspect.pathKey(),
                    });
                    void queryClient.invalidateQueries({
                      queryKey: trpc.explore.intentStatus.queryKey({
                        intentId: props.intent.intentId,
                      }),
                    });
                  },
                },
              );
            }}
          >
            {mutation.isPending
              ? "Confirming…"
              : displayedOutcome === null
                ? "Confirm"
                : "Try again"}
          </Button>
        </div>
      ) : (
        <IntentOutcomeMessage outcome={displayedOutcome} />
      )}
      {displayedOutcome?.status === "failed" && displayedOutcome.retryable && (
        <p className="text-sm capitalize text-scout-danger">
          {displayedOutcome.message}
        </p>
      )}
      {persisted.error !== null && (
        <p className="text-sm text-scout-danger">{persisted.error.message}</p>
      )}
      {outcome?.deliveryWarning !== null &&
        outcome?.deliveryWarning !== undefined && (
          <p className="text-sm text-scout-danger">{outcome.deliveryWarning}</p>
        )}
      {mutation.error !== null && (
        <p className="text-sm text-scout-danger">{mutation.error.message}</p>
      )}
    </section>
  );
}
