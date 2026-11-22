const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DIGEST = /^(?<algorithm>[a-z0-9]+):(?<hex>[0-9a-f]{32,})$/iu;
/** How much of a long id its short form keeps. */
const SHORT_LENGTH = 12;
/** An id of no known shape is cut only past this length. */
const LONG_LENGTH = 20;

/** Whether an id is a UUID or a digest: a shape nobody reads past its start. */
export function isOpaqueIdentifier(value: string) {
  return UUID.test(value) || DIGEST.test(value);
}

/** The short form of a long id: a UUID's first group, a digest's first 12 hex digits, or a prefix. */
export function shortIdentifier(value: string) {
  if (UUID.test(value)) return value.slice(0, 8);
  const digest = DIGEST.exec(value)?.groups;
  if (digest !== undefined)
    return `${digest["algorithm"] ?? ""}:${(digest["hex"] ?? "").slice(0, SHORT_LENGTH)}`;
  return value.length > LONG_LENGTH
    ? `${value.slice(0, SHORT_LENGTH)}…`
    : value;
}

/** A long id (UUID, digest, operation id) in a short monospace form; the full value stays in `title` and in the accessible text. */
export function Identifier({ value }: { value: string }) {
  const short = shortIdentifier(value);
  if (short === value) return <span className="mono identifier">{value}</span>;
  return (
    <abbr className="mono identifier" title={value}>
      <span aria-hidden="true">{short}</span>
      <span className="visually-hidden">{value}</span>
    </abbr>
  );
}

/** A version-set revision number as people say it: `r274`. */
export function revisionLabel(revision: number) {
  return `r${String(revision)}`;
}

/** A version-set revision as its r-number; its full id, when known, in `title`. */
export function Revision({ revision, id }: { revision: number; id?: string }) {
  return (
    <span className="revision" title={id}>
      {revisionLabel(revision)}
    </span>
  );
}
