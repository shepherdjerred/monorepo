const failures = {
  not_interactable: {
    code: "control_not_interactable",
    message:
      "Control is hidden or disabled. Refresh the snapshot and choose a visible enabled control.",
  },
  inspection_failed: {
    code: "control_inspection_failed",
    message:
      "Control inspection failed before action dispatch. Refresh the snapshot and inspect another visible label or control. No click was sent.",
  },
  pointer_preflight_failed: {
    code: "pointer_preflight_failed",
    message:
      "Pointer preflight failed before click dispatch. The control may be covered or out of reach. Inspect the page, scroll or reposition, then refresh the snapshot and try the observed control again. No click was sent.",
  },
  captcha_required: {
    code: "captcha_required",
    message:
      "Solve the CAPTCHA before submitting sign-in. No login attempt was sent; use captcha.ts, then submit the same observed login control.",
  },
  unapproved_payload: {
    code: "unapproved_payload",
    message:
      "Payload must exactly match an approved-messages.json variant. No Discord action was prepared or sent. Select content with JSON.parse(await Bun.file('approved-messages.json').text())[index], then write the request with JSON.stringify({content}); preserve its exact bytes without trimming.",
  },
} as const;

export class PromotionControlError extends Error {
  readonly code:
    | "control_not_interactable"
    | "control_inspection_failed"
    | "pointer_preflight_failed"
    | "captcha_required"
    | "unapproved_payload";
  readonly dispatchState = "not_started";
  readonly retryable = true;
  constructor(
    readonly ref: string,
    reason: keyof typeof failures = "not_interactable",
  ) {
    super(failures[reason].message);
    this.code = failures[reason].code;
  }
}
