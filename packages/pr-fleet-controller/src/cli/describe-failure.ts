/**
 * Render a thrown value for the operator.
 *
 * A stack is preferred because it locates the failure, but some libraries
 * throw errors whose stack is only the class name: zod sets `ZodError.stack`
 * to "ZodError" and carries the offending field paths in `message`. Printing
 * such a stack alone would drop the only part that says what is actually
 * wrong, so append the message whenever the stack does not already contain it.
 */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const stack = error.stack;
  if (stack === undefined) return error.message;
  return stack.includes(error.message) ? stack : `${stack}: ${error.message}`;
}
