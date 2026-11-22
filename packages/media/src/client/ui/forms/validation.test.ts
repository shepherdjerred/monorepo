import { expect, test } from "vitest";
import { constraintMessage, type ConstrainedControl } from "./validation.ts";

const VALID = {
  valid: true,
  valueMissing: false,
  badInput: false,
  rangeUnderflow: false,
  rangeOverflow: false,
  stepMismatch: false,
  tooShort: false,
  tooLong: false,
  patternMismatch: false,
  typeMismatch: false,
};

function control(
  failing: Partial<typeof VALID>,
  rest: Partial<ConstrainedControl> = {},
): ConstrainedControl {
  return {
    type: "text",
    validity: { ...VALID, valid: false, ...failing },
    validationMessage: "The browser's own words.",
    dataset: {},
    ...rest,
  };
}

test("an acceptable value has no message", () => {
  expect(constraintMessage({ ...control({}), validity: VALID })).toBeNull();
});

test("an empty required control is told what is missing", () => {
  expect(constraintMessage(control({ valueMissing: true }))).toBe(
    "This cannot be empty.",
  );
  expect(
    constraintMessage(control({ valueMissing: true }, { type: "checkbox" })),
  ).toBe("Tick this box to continue.");
  expect(
    constraintMessage(control({ valueMissing: true }, { type: "select-one" })),
  ).toBe("Choose an option.");
  expect(
    constraintMessage(control({ valueMissing: true }, { type: "file" })),
  ).toBe("Choose a file.");
  expect(
    constraintMessage(
      control(
        { valueMissing: true },
        { dataset: { requiredMessage: "Enter this profile’s PIN." } },
      ),
    ),
  ).toBe("Enter this profile’s PIN.");
});

test("a number out of bounds is told the bound", () => {
  const number = { type: "number", min: "1", max: "3600", step: "1" };
  expect(constraintMessage(control({ badInput: true }, number))).toBe(
    "Enter a number.",
  );
  expect(constraintMessage(control({ rangeUnderflow: true }, number))).toBe(
    "Enter 1 or more.",
  );
  expect(constraintMessage(control({ rangeOverflow: true }, number))).toBe(
    "Enter 3600 or less.",
  );
  expect(constraintMessage(control({ stepMismatch: true }, number))).toBe(
    "Enter a whole number.",
  );
});

test("text of the wrong length or shape is told the rule", () => {
  expect(
    constraintMessage(control({ tooShort: true }, { minLength: 10 })),
  ).toBe("Use at least 10 characters.");
  expect(constraintMessage(control({ tooLong: true }, { maxLength: 4 }))).toBe(
    "Use at most 4 characters.",
  );
  expect(
    constraintMessage(
      control(
        { patternMismatch: true },
        { dataset: { patternMessage: "Enter the four digits of the PIN." } },
      ),
    ),
  ).toBe("Enter the four digits of the PIN.");
  expect(
    constraintMessage(control({ typeMismatch: true }, { type: "url" })),
  ).toBe("Enter a full address, such as https://example.com.");
});

test("anything else falls back to the browser's message", () => {
  expect(constraintMessage(control({ patternMismatch: true }))).toBe(
    "The browser's own words.",
  );
});
