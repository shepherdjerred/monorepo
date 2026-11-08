import { MediaError } from "#application/errors.ts";

export class NativeCompensationProtection extends MediaError {
  constructor(readonly reason: string) {
    super(
      reason,
      "Publication compensation remains protected; review its exact recovery state",
      409,
    );
    this.name = "NativeCompensationProtection";
  }
}
