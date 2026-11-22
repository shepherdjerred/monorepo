/**
 * Turns a control's own constraints (`required`, `min`, `pattern`, …) into
 * a sentence that says how to fix the value. The browser's messages are in
 * the browser's language and say "Please fill out this field" for
 * everything; these are the product's.
 */

/** The parts of an input, select, or textarea that a message is built from. */
export type ConstrainedControl = {
  type: string;
  validity: Pick<
    ValidityState,
    | "valid"
    | "valueMissing"
    | "badInput"
    | "rangeUnderflow"
    | "rangeOverflow"
    | "stepMismatch"
    | "tooShort"
    | "tooLong"
    | "patternMismatch"
    | "typeMismatch"
  >;
  validationMessage: string;
  /** Messages a field supplied for its own constraints. */
  dataset: { requiredMessage?: string; patternMessage?: string };
  min?: string;
  max?: string;
  step?: string;
  minLength?: number;
  maxLength?: number;
};

function missing(control: ConstrainedControl): string {
  if (control.dataset.requiredMessage !== undefined) {
    return control.dataset.requiredMessage;
  }
  if (control.type === "checkbox") return "Tick this box to continue.";
  if (control.type === "file") return "Choose a file.";
  return control.type.startsWith("select")
    ? "Choose an option."
    : "This cannot be empty.";
}

/** What is wrong with the control's value, or `null` when nothing is. */
export function constraintMessage(control: ConstrainedControl): string | null {
  const { validity } = control;
  if (validity.valid) return null;
  if (validity.valueMissing) return missing(control);
  if (validity.badInput) return "Enter a number.";
  if (validity.rangeUnderflow) {
    return `Enter ${control.min ?? "a larger number"} or more.`;
  }
  if (validity.rangeOverflow) {
    return `Enter ${control.max ?? "a smaller number"} or less.`;
  }
  if (validity.stepMismatch && (control.step ?? "") !== "any") {
    return "Enter a whole number.";
  }
  // A field that says what its pattern is says it better than a count of
  // characters does.
  if (
    validity.patternMismatch &&
    control.dataset.patternMessage !== undefined
  ) {
    return control.dataset.patternMessage;
  }
  if (validity.tooShort) {
    return `Use at least ${String(control.minLength)} characters.`;
  }
  if (validity.tooLong) {
    return `Use at most ${String(control.maxLength)} characters.`;
  }
  return validity.typeMismatch && control.type === "url"
    ? "Enter a full address, such as https://example.com."
    : control.validationMessage;
}
