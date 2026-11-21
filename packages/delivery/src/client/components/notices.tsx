/**
 * An error in the words a person reads. A Delivery API error is its message
 * alone: the code (`CONFLICT`, `INVALID`) is for programs, not for people.
 */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ErrorNotice({ error }: { error: unknown }) {
  return (
    <div className="notice error" role="alert">
      {errorMessage(error)}
    </div>
  );
}
