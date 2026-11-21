import { useId, useRef, useState } from "react";

/**
 * The reason a human decision records. It is controlled, so it survives a
 * refused request; `require` checks it before a decision is sent or asked
 * about, and when it is missing says so at the field and focuses it.
 */
export function useReason() {
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();
  function require(missing: string) {
    if (value.trim() !== "") {
      setProblem(null);
      return true;
    }
    setProblem(missing);
    field.current?.focus();
    return false;
  }
  return {
    value: value.trim(),
    field: { value, setValue, problem, setProblem, field, errorId },
    require,
  };
}

/** A required reason, marked as required, with what is wrong with it beneath. */
export function ReasonField({
  reason,
  placeholder,
}: {
  reason: ReturnType<typeof useReason>;
  placeholder: string;
}) {
  const { value, setValue, problem, setProblem, field, errorId } = reason.field;
  return (
    <>
      <label>
        Reason (required)
        <textarea
          ref={field}
          name="reason"
          required
          maxLength={4000}
          rows={3}
          value={value}
          aria-invalid={problem !== null}
          aria-describedby={problem === null ? undefined : errorId}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            if (event.currentTarget.value.trim() !== "") setProblem(null);
          }}
          placeholder={placeholder}
        />
      </label>
      {problem !== null && (
        <p className="notice error" id={errorId} role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

/** Focus the element as it mounts; stable, so a later render does not move focus again. */
function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

/**
 * What a decision just did, stated where focus lands: the form that took it
 * leaves the page, and focus would otherwise drop to the document.
 */
export function DecisionOutcome({ text }: { text: string }) {
  return (
    <p
      className="notice success decision-outcome"
      role="status"
      tabIndex={-1}
      ref={focusOnMount}
    >
      {text}
    </p>
  );
}
