export class PromotionControlError extends Error {
  readonly code:
    | "control_not_interactable"
    | "control_inspection_failed"
    | "captcha_required";
  readonly dispatchState = "not_started";
  readonly retryable = true;
  constructor(
    readonly ref: string,
    reason:
      | "not_interactable"
      | "inspection_failed"
      | "captcha_required" = "not_interactable",
  ) {
    super(
      reason === "captcha_required"
        ? "Solve the CAPTCHA before submitting sign-in. No login attempt was sent; use captcha.ts, then submit the same observed login control."
        : reason === "inspection_failed"
          ? "Control inspection failed before action dispatch. Refresh the snapshot and inspect another visible label or control. No click was sent."
          : "Control is hidden or disabled. Refresh the snapshot and choose a visible enabled control.",
    );
    this.code =
      reason === "captcha_required"
        ? "captcha_required"
        : reason === "inspection_failed"
          ? "control_inspection_failed"
          : "control_not_interactable";
  }
}
