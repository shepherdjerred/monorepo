/**
 * A recorded error often arrives as the runtime printed it: an excerpt of
 * the source bundle around the throw (`21895 | ${body}`);`), a caret line
 * under it, the error's own sentence and its stack frames. Only the sentence
 * is for a reader; the rest is kept for the disclosure that holds the raw
 * text.
 */

/** A line of the bundle excerpt a runtime prints around a throw: `21895 | code`. */
const SOURCE_LINE = /^\s*\d+\s*\|/u;
/** The caret line that points into that excerpt. */
const CARET_LINE = /^\s*\^+\s*$/u;
/** A stack frame: `at assertApplySafe (/app/dist/file.js:21900:11)`. */
const STACK_FRAME = /^\s*at\s\S.*(?:\(|:\d+)/u;
/** The error name or `error:` a runtime puts before the sentence. */
const ERROR_PREFIX = /^(?:[A-Za-z]*Error|error)\s*:\s*/u;

function isTraceLine(line: string) {
  return (
    SOURCE_LINE.test(line) || CARET_LINE.test(line) || STACK_FRAME.test(line)
  );
}

/** Whether a recorded text carries source excerpts or stack frames. */
export function hasTrace(text: string) {
  return text.split("\n").some((line) => isTraceLine(line));
}

/**
 * The human sentence of a recorded error: its lines that are neither source
 * excerpt nor stack frame, joined, without the runtime's error prefix. A
 * text with no trace in it is returned as written. Empty when nothing but
 * trace is left.
 */
export function plainCause(text: string) {
  return hasTrace(text)
    ? text
        .split("\n")
        .filter((line) => !isTraceLine(line))
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .join(" ")
        .replace(ERROR_PREFIX, "")
    : text;
}
