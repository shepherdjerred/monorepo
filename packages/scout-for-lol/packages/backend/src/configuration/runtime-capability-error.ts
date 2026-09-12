/**
 * The refusal a process raises when asked to do something its runtime role
 * does not declare.
 *
 * Deliberately transport-neutral and deliberately here rather than in
 * `runtime/`. The capability *vocabulary* lives in `configuration/` — a leaf
 * every layer may import — precisely so that a guard can be written at the
 * place the work actually happens without that module gaining a dependency on
 * the composition root. `customs/voice-capability.ts` raises an HTTP-shaped
 * refusal because its only caller is an HTTP endpoint; a guard on a shared
 * read path has callers on every transport, so its error must name a
 * capability and nothing else. Each transport maps it to its own status.
 */

export class RuntimeCapabilityError extends Error {
  constructor(
    /** The {@link ScoutRuntimeCapabilities} field this process does not hold. */
    readonly capability: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeCapabilityError";
  }
}
