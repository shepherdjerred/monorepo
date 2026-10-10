import { NoopProvider } from "@shepherdjerred/feature-flags/providers/noop.ts";

/** Pin global runtime settings; guild policies still use the replay registry. */
export class ReplayRuntimeProvider extends NoopProvider {
  constructor(
    private readonly runtime: { analysisEnabled: boolean; model: string },
  ) {
    super();
  }

  override resolveBooleanEvaluation(
    ...args: Parameters<NoopProvider["resolveBooleanEvaluation"]>
  ) {
    return args[0] === "scout-explore-analysis-enabled"
      ? Promise.resolve({
          value: this.runtime.analysisEnabled,
          reason: "STATIC",
        })
      : super.resolveBooleanEvaluation(...args);
  }

  override resolveStringEvaluation(
    ...args: Parameters<NoopProvider["resolveStringEvaluation"]>
  ) {
    return args[0] === "scout-explore-model"
      ? Promise.resolve({ value: this.runtime.model, reason: "STATIC" })
      : super.resolveStringEvaluation(...args);
  }
}
