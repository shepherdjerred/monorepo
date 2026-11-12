export class PromotionControlError extends Error {
  readonly code:
    | "control_not_interactable"
    | "control_inspection_failed"
    | "captcha_required"
    | "unapproved_payload";
  readonly dispatchState = "not_started";
  readonly retryable = true;
  constructor(
    readonly ref: string,
    reason:
      | "not_interactable"
      | "inspection_failed"
      | "captcha_required"
      | "unapproved_payload" = "not_interactable",
  ) {
    super(
      reason === "unapproved_payload"
        ? "Payload must exactly match an approved-messages.json variant. No Discord action was prepared or sent. Select content with JSON.parse(await Bun.file('approved-messages.json').text())[index], then write the request with JSON.stringify({content}); preserve its exact bytes without trimming."
        : reason === "captcha_required"
          ? "Solve the CAPTCHA before submitting sign-in. No login attempt was sent; use captcha.ts, then submit the same observed login control."
          : reason === "inspection_failed"
            ? "Control inspection failed before action dispatch. Refresh the snapshot and inspect another visible label or control. No click was sent."
            : "Control is hidden or disabled. Refresh the snapshot and choose a visible enabled control.",
    );
    this.code =
      reason === "unapproved_payload"
        ? "unapproved_payload"
        : reason === "captcha_required"
          ? "captcha_required"
          : reason === "inspection_failed"
            ? "control_inspection_failed"
            : "control_not_interactable";
  }
}
