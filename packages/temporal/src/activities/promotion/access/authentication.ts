import type { PromotionBrowser } from "#activities/promotion/browser.ts";
import { PromotionControlError } from "#activities/promotion/control-error.ts";

type Credential = "username" | "email" | "password" | "otp" | "email-code";
type Phase = "identifier" | "password" | "otp";
type Control = { role: string; name?: string | undefined };

function phase(kind: Credential): Phase {
  if (kind === "email-code") return "otp";
  return kind === "username" || kind === "email" ? "identifier" : kind;
}

/** Grants bounded credential submissions; the agent still chooses native controls. */
export class PromotionAuthentication {
  private readonly pages = new Map<Phase, string>();
  private readonly submitted = new Set<Phase>();
  private otpFilled = false;

  constructor(private readonly browser: PromotionBrowser) {}

  assertCredential(kind: Credential): void {
    if (phase(kind) === "otp") {
      if (this.otpFilled)
        throw new Error("Second-factor code already filled for this run");
      return;
    }
    if (this.submitted.has("password") || this.submitted.has(phase(kind)))
      throw new Error(
        "Login already submitted; inspect the result instead of retrying",
      );
  }

  record(kind: Credential, page: string): void {
    this.pages.set(phase(kind), page);
    if (phase(kind) === "otp") this.otpFilled = true;
  }

  navigated(): void {
    this.pages.clear();
  }

  allowsControl(node: Control, page: string): boolean {
    if (node.role !== "button") return false;
    const name = (node.name ?? "").replaceAll(/\p{Co}/gu, "").trim();
    const googleNext =
      new URL(page).hostname === "accounts.google.com" && /^next$/i.test(name);
    const verification =
      this.pages.has("otp") &&
      /^(?:verify|confirm|continue)(?:\s+(?:code|verification|account))?$/i.test(
        name,
      );
    const signIn =
      /\b(?:log|sign)\s*in\b/i.test(name) &&
      !/\b(?:bump|vote|publish|post|reply|submit|send|comment|purchase|delete|remove|save|accept|join)\b/i.test(
        name,
      );
    return googleNext || verification || signIn;
  }

  private pending(page: string): Phase {
    for (const kind of ["otp", "password"] as const)
      if (this.pages.get(kind) === page) return kind;
    if (
      new URL(page).hostname === "accounts.google.com" &&
      this.pages.get("identifier") === page
    )
      return "identifier";
    throw new Error("Fill the stored password on this page before login");
  }

  async submit(
    body: Record<string, unknown> & { ref: string },
  ): Promise<unknown> {
    const kind = this.pending(await this.browser.currentUrl());
    if (this.submitted.has(kind))
      throw new Error(
        "Login already submitted; inspect the result instead of retrying",
      );
    if ((await this.browser.attribute(body.ref, "disabled")) !== null)
      throw new Error(
        "Login control is disabled; inspect the form before submitting",
      );
    if (await this.browser.requiresCaptchaResponse())
      throw new PromotionControlError(body.ref, "captcha_required");
    this.submitted.add(kind);
    return await this.browser.action(body);
  }
}
