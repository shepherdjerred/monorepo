import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  Input,
  Label,
  Textarea,
} from "@scout-for-lol/design-system/components/forms/field";
import {
  operationsArmLabel,
  operationsRequestSummary,
  type OperationsRequestDraft,
} from "#src/lib/operations/operations-payloads.ts";

/**
 * What an operator fills in before an intent is minted.
 *
 * Only two arms take anything: a suppression takes the operator's written
 * reason, and an unknown delivery takes the answer. Everything else is named
 * entirely by the row it was started from, so this renders the recap and the
 * one button.
 *
 * The attempt nonce is shown but never editable. It comes off the intent state
 * the console is displaying, and the whole point of the domain requiring it is
 * that the operator answers the attempt they looked at — a field they could
 * type into would let a stale view answer a newer attempt, which is exactly
 * what `stale-operator-view` exists to refuse.
 */

function SuppressFields(props: {
  draft: OperationsRequestDraft & { kind: "ops_suppress_stale_notification" };
  onChange: (draft: OperationsRequestDraft) => void;
}) {
  return (
    <Field>
      <Label htmlFor="operations-note">Why now</Label>
      <Textarea
        id="operations-note"
        rows={3}
        maxLength={280}
        value={props.draft.note}
        onChange={(event) => {
          props.onChange({ ...props.draft, note: event.target.value });
        }}
      />
      <FieldDescription>
        Recorded on the audit row, not on the intent. The machine stamps the
        suppression reason itself.
      </FieldDescription>
    </Field>
  );
}

function DeliveryFields(props: {
  draft: OperationsRequestDraft & { kind: "ops_resolve_unknown_delivery" };
  onChange: (draft: OperationsRequestDraft) => void;
}) {
  const { draft } = props;
  return (
    <div className="space-y-3">
      <Field>
        <Label htmlFor="operations-attempt">Attempt</Label>
        <Input
          id="operations-attempt"
          readOnly
          value={draft.attemptNonce}
          className="font-mono"
        />
        <FieldDescription>
          The attempt this console is showing. The machine refuses an answer
          that names a different one.
        </FieldDescription>
      </Field>
      <Field>
        <Label htmlFor="operations-answer">What you found</Label>
        <div className="flex gap-2" id="operations-answer">
          <Button
            type="button"
            size="sm"
            variant={draft.outcome === "not-delivered" ? "default" : "outline"}
            onClick={() => {
              props.onChange({ ...draft, outcome: "not-delivered" });
            }}
          >
            No message was sent
          </Button>
          <Button
            type="button"
            size="sm"
            variant={draft.outcome === "delivered" ? "default" : "outline"}
            onClick={() => {
              props.onChange({ ...draft, outcome: "delivered" });
            }}
          >
            The message is there
          </Button>
        </div>
        <FieldDescription>
          {draft.outcome === "delivered"
            ? "Delivered is permanent and cannot be revised. Name the message you found."
            : "Confirming it was never sent releases the intent for a fresh attempt."}
        </FieldDescription>
      </Field>
      {draft.outcome === "delivered" && (
        <>
          <Field>
            <Label htmlFor="operations-message">Message id</Label>
            <Input
              id="operations-message"
              value={draft.messageId}
              inputMode="numeric"
              onChange={(event) => {
                props.onChange({ ...draft, messageId: event.target.value });
              }}
            />
          </Field>
          <Field>
            <Label htmlFor="operations-delivered-at">Delivered at</Label>
            <div className="flex gap-2">
              <Input
                id="operations-delivered-at"
                value={draft.deliveredAt}
                placeholder="2026-09-13T10:30:00Z"
                onChange={(event) => {
                  props.onChange({ ...draft, deliveredAt: event.target.value });
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  props.onChange({
                    ...draft,
                    deliveredAt: new Date().toISOString(),
                  });
                }}
              >
                Now
              </Button>
            </div>
            <FieldDescription>
              When the message was actually posted, as an ISO instant. &ldquo;
              Now&rdquo; is only right if you are looking at it as it lands.
            </FieldDescription>
          </Field>
        </>
      )}
    </div>
  );
}

function DraftFields(props: {
  draft: OperationsRequestDraft;
  onChange: (draft: OperationsRequestDraft) => void;
}) {
  if (props.draft.kind === "ops_suppress_stale_notification") {
    return <SuppressFields draft={props.draft} onChange={props.onChange} />;
  }
  return props.draft.kind === "ops_resolve_unknown_delivery" ? (
    <DeliveryFields draft={props.draft} onChange={props.onChange} />
  ) : null;
}

export function OperationsRequestForm(props: {
  draft: OperationsRequestDraft;
  onChange: (draft: OperationsRequestDraft) => void;
  onPrepare: () => void;
  onCancel: () => void;
  preparing: boolean;
  /** Why the draft is not yet a valid payload, from the shared schema. */
  invalid: string | null;
  /** A failure minting the intent, which never leaves one behind. */
  errorMessage: string | null;
}) {
  return (
    <section
      data-operations-request={props.draft.kind}
      className="space-y-3 rounded-lg border border-scout-border bg-scout-surface p-4"
    >
      <h3 className="font-medium">{operationsArmLabel(props.draft.kind)}</h3>
      <p className="text-sm text-scout-subtle">
        {operationsRequestSummary(props.draft)}
      </p>
      <DraftFields draft={props.draft} onChange={props.onChange} />
      {props.invalid !== null && <FieldError>{props.invalid}</FieldError>}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={props.preparing || props.invalid !== null}
          onClick={props.onPrepare}
        >
          {props.preparing ? "Preparing…" : "Prepare"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={props.preparing}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
      </div>
      {props.errorMessage !== null && (
        <p className="text-sm text-scout-danger">{props.errorMessage}</p>
      )}
    </section>
  );
}
