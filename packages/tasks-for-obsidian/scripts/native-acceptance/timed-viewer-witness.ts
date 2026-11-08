import assert from "node:assert/strict";

export type TimedViewerWitness = {
  day: string;
  timeZone: string;
  instant: string;
  source: string;
};

/** A real viewer-day instant whose written date would be wrong if sliced. */
export function timedViewerWitness(day: string): TimedViewerWitness {
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const time of ["00:30:00", "23:30:00"]) {
    const instant = new Date(`${day}T${time}`);
    const source = instant.toISOString();
    if (source.slice(0, 10) !== day) {
      return validate({ day, timeZone, instant: source, source });
    }
  }
  // UTC viewers have no crossing UTC prefix. Preserve the same instant with a
  // written source offset instead; the runtime retains that original property.
  const instant = new Date(`${day}T12:00:00`).toISOString();
  for (const offset of [-12 * 60, 14 * 60]) {
    const written = new Date(Date.parse(instant) + offset * 60_000)
      .toISOString()
      .slice(0, 19);
    const source = written + (offset < 0 ? "-12:00" : "+14:00");
    if (source.slice(0, 10) !== day) {
      return validate({ day, timeZone, instant, source });
    }
  }
  throw new Error("No crossing-midnight witness for the actual viewer day");
}

function validate(witness: TimedViewerWitness): TimedViewerWitness {
  assert.notEqual(witness.source.slice(0, 10), witness.day);
  assert.equal(Date.parse(witness.source), Date.parse(witness.instant));
  const resolved = new Intl.DateTimeFormat("en-CA", {
    timeZone: witness.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(witness.source));
  assert.equal(
    resolved,
    witness.day,
    "Timed witness must resolve to the real viewer day",
  );
  return witness;
}
