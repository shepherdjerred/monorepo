export type PushOutcome = {
  readonly image: string;
  readonly outcome:
    | "bumped"
    | "content-unchanged"
    | "pin-unresolvable-bumped"
    | "no-pin-bumped";
};

export type PushOptions = {
  readonly targets: readonly string[];
  readonly commit: string;
  readonly buildNumber: string;
  readonly contractHash: string;
  /**
   * The exact-digest smoke harness changed since the image base (or the base
   * is unknown), so retained originals have not met it yet.
   */
  readonly exactHarnessChanged?: boolean;
};
