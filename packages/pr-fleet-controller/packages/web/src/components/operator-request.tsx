import { useState, type ReactElement, type SyntheticEvent } from "react";
import type { OperatorInputRequest } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { z } from "zod";

const ErrorBodySchema = z.object({ error: z.string() });

export function OperatorRequest({
  request,
  interactive,
}: {
  request: OperatorInputRequest;
  interactive: boolean;
}): ReactElement {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const submit = async (
    event: SyntheticEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    const answers = request.questions.map((question) => {
      const freeText = notes[question.id]?.trim() ?? "";
      return {
        questionId: question.id,
        optionId: selected[question.id] ?? null,
        freeText: freeText.length === 0 ? null : freeText,
      };
    });
    if (
      answers.some(
        (answer) => answer.optionId === null && answer.freeText === null,
      )
    ) {
      setError("Answer every question with a choice or free text.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/operator-requests/${encodeURIComponent(request.id)}/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: request.id, answers }),
        },
      );
      if (!response.ok) {
        const body: unknown = await response.json();
        const parsed = ErrorBodySchema.safeParse(body);
        const message = parsed.success
          ? parsed.data.error
          : `Answer failed (${String(response.status)})`;
        throw new Error(message);
      }
      setAccepted(true);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : String(submissionError),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="operator-request">
      <div className="operator-request-head">
        <div>
          <h3>Operator input needed</h3>
          <p>{request.context}</p>
        </div>
        <span className="mono">{request.id}</span>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        {request.questions.map((question) => (
          <fieldset key={question.id} disabled={!interactive || submitting}>
            <legend>{question.header}</legend>
            <p>{question.question}</p>
            <div className="operator-options">
              {question.options.map((option) => (
                <label key={option.id}>
                  <input
                    type="radio"
                    name={question.id}
                    value={option.id}
                    checked={selected[question.id] === option.id}
                    onChange={() => {
                      setSelected((current) => ({
                        ...current,
                        [question.id]: option.id,
                      }));
                    }}
                  />
                  <span>
                    <strong>
                      {option.label}
                      {option.recommended ? " (Recommended)" : ""}
                    </strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
            <label className="operator-notes">
              Other or additional guidance
              <textarea
                value={notes[question.id] ?? ""}
                onChange={(event) => {
                  setNotes((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }));
                }}
              />
            </label>
          </fieldset>
        ))}
        {accepted ? (
          <p className="operator-success">Answer accepted. Requeuing PR…</p>
        ) : null}
        {error === null ? null : <p className="operator-error">{error}</p>}
        <button type="submit" disabled={!interactive || submitting || accepted}>
          {interactive
            ? submitting
              ? "Submitting…"
              : "Submit answer"
            : "Historical view — answers disabled"}
        </button>
      </form>
    </section>
  );
}
