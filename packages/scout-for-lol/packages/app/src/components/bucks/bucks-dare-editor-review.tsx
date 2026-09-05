import type { DareDeadlineSpecV2 } from "@scout-for-lol/data";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";

export type ValidatedDareDraft = {
  canonicalScoutQl: string;
  plainLanguage: string;
  semanticProofPlan: string;
  scoutQlPlanHash: string;
  scoutQlFacts: {
    cteCount: number;
    joinedRelations: number;
    predicates: number;
    maxExpressionDepth: number;
    physicalSources: string[];
    functions: string[];
    targetKeys: string[];
  };
};

type DareEditorReviewProps = {
  validated: ValidatedDareDraft | null;
  reviewing: boolean;
  sqlV3: boolean;
  currentRevision: number;
  previous: {
    plainLanguage: string;
    originalText: string;
    deadlineSpec: DareDeadlineSpecV2;
    openingStake: number;
  };
  next: {
    originalText: string;
    deadlineText: string;
    stakeText: string;
  };
};

export function DareEditorReview(props: DareEditorReviewProps) {
  return (
    <>
      {props.validated !== null && (
        <section className="space-y-3">
          <h3 className="font-medium">
            {props.sqlV3 ? "Canonical binding SQL" : "Generated ScoutQL"}
          </h3>
          <ScoutQlCode queryText={props.validated.canonicalScoutQl} />
          <p className="whitespace-pre-wrap text-sm">
            {props.validated.plainLanguage}
          </p>
          <p className="whitespace-pre-wrap text-sm text-scout-subtle">
            {props.validated.semanticProofPlan}
          </p>
          <p className="text-xs text-scout-muted-foreground">
            Plan {props.validated.scoutQlPlanHash.slice(0, 12)} ·{" "}
            {props.validated.scoutQlFacts.cteCount.toString()} CTEs ·{" "}
            {props.validated.scoutQlFacts.joinedRelations.toString()} joins ·{" "}
            {props.validated.scoutQlFacts.predicates.toString()} predicates ·
            depth {props.validated.scoutQlFacts.maxExpressionDepth.toString()}
          </p>
        </section>
      )}
      {props.reviewing && props.validated !== null && (
        <section className="grid gap-3 rounded-md border border-scout-border p-3 text-sm md:grid-cols-2">
          <div>
            <h3 className="font-medium">
              Before · revision {props.currentRevision.toString()}
            </h3>
            <p className="mt-2 whitespace-pre-wrap">
              {props.previous.plainLanguage}
            </p>
            <ReviewValue
              label="Original request"
              value={props.previous.originalText}
            />
            <ReviewValue
              label="Deadline"
              value={JSON.stringify(props.previous.deadlineSpec, null, 2)}
            />
            <ReviewValue
              label="Opening stake"
              value={`${props.previous.openingStake.toString()} BB`}
            />
          </div>
          <div>
            <h3 className="font-medium">
              After · revision {(props.currentRevision + 1).toString()}
            </h3>
            <p className="mt-2 whitespace-pre-wrap">
              {props.validated.plainLanguage}
            </p>
            <ReviewValue
              label="Original request"
              value={props.next.originalText}
            />
            <ReviewValue label="Deadline" value={props.next.deadlineText} />
            <ReviewValue
              label="Opening stake"
              value={`${Number(props.next.stakeText).toString()} BB`}
            />
          </div>
        </section>
      )}
    </>
  );
}

function ReviewValue(props: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <h4 className="text-xs font-medium text-scout-subtle">{props.label}</h4>
      <p className="mt-1 whitespace-pre-wrap font-mono text-xs">
        {props.value}
      </p>
    </div>
  );
}
