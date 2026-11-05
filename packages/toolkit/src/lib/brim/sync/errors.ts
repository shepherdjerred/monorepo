/**
 * A sync failure the operator fixes with configuration or one recovery step.
 * The CLI prints only its message; anything else is a broken contract and
 * keeps its stack.
 */
export class SyncSetupError extends Error {
  override readonly name = "SyncSetupError";
}
