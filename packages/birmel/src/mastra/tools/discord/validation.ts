/**
 * Discord ID validation utilities for Mastra tools.
 * Discord IDs (snowflakes) are numeric strings, typically 17-20 digits.
 */

const SNOWFLAKE_REGEX = /^\d{17,20}$/;

/**
 * Validates that a string is a valid Discord snowflake ID.
 * Returns an error message if invalid, or null if valid.
 */
export function validateSnowflake(value: string | null | undefined, fieldName: string): string | null {
  if (!value) {return null;} // Let required field checks handle missing values (null and undefined are ok)

  if (value === "@me") {
    return `Invalid ${fieldName}. Use the numeric Discord ID from the message context (e.g., '123456789012345678'), not '@me'.`;
  }

  if (!SNOWFLAKE_REGEX.test(value)) {
    return `Invalid ${fieldName}. Discord IDs must be numeric strings (17-20 digits). Got: '${value}'`;
  }

  return null;
}

/**
 * Validates multiple snowflake IDs at once.
 * Returns the first error found, or null if all are valid.
 */
export function validateSnowflakes(
  values: { value: string | null | undefined; fieldName: string }[]
): string | null {
  for (const { value, fieldName } of values) {
    const error = validateSnowflake(value, fieldName);
    if (error) {return error;}
  }
  return null;
}

/**
 * Validates an array of snowflake IDs.
 * Returns an error message if any ID is invalid, or null if all are valid.
 */
export function validateSnowflakeArray(values: string[] | null | undefined, fieldName: string): string | null {
  if (!values) {return null;}

  for (const [i, value] of values.entries()) {
    const error = validateSnowflake(value, `${fieldName}[${String(i)}]`);
    if (error) {return error;}
  }

  return null;
}
