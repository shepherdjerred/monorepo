import { createHash } from "node:crypto";
import { assertPromotionReceipt } from "./receipt.ts";
import {
  assertPromotionUrl,
  promotionEligibility,
  type PromotionObservation,
  type PromotionPreflight,
  type PromotionTarget,
} from "#shared/promotion.ts";
import {
  assertPromotionOwnership,
  readPromotionState,
  updatePromotionState,
  type PromotionStore,
} from "./store.ts";

export type PromotionGatewayDependencies = {
  store: PromotionStore;
  target: PromotionTarget;
  occurrenceId: string;
  preview: boolean;
  enabled: () => Promise<boolean>;
  now: () => number;
  // Only this parent-owned operation can perform a final submission.
  submit: (selector: string) => Promise<void>;
  capture: () => Promise<{
    url: string;
    text: string;
    screenshotKey: string;
    publishedAt?: string | null | undefined;
  }>;
};

export class PromotionGateway {
  readonly observations: PromotionObservation[] = [];
  private readonly dependencies: PromotionGatewayDependencies;
  private currentPreflight: PromotionPreflight | undefined;
  private submitted = false;

  constructor(dependencies: PromotionGatewayDependencies) {
    this.dependencies = dependencies;
  }

  observe(url: string, text: string): PromotionObservation {
    assertPromotionUrl(this.dependencies.target, url);
    const observation = {
      id: crypto.randomUUID(),
      url,
      text,
      capturedAt: new Date(this.dependencies.now()).toISOString(),
    };
    this.observations.push(observation);
    return observation;
  }

  async preflight(preflight: PromotionPreflight) {
    const { store, target, occurrenceId, now } = this.dependencies;
    const state = await readPromotionState(store, target.id);
    assertPromotionOwnership(state, occurrenceId);
    const decision = promotionEligibility({
      target,
      state,
      preflight,
      observations: this.observations,
      now: now(),
    });
    await updatePromotionState(store, target.id, (current) => {
      assertPromotionOwnership(current, occurrenceId);
      return {
        ...current,
        preflight,
        checkedAt: new Date(now()).toISOString(),
        nextEligibleAt: decision.nextEligibleAt,
      };
    });
    this.currentPreflight = preflight;
    return decision;
  }

  async publish(selector: string, content: string) {
    const { store, target, occurrenceId, now, preview, enabled, submit } =
      this.dependencies;
    if (preview) throw new Error("Preview cannot publish");
    if (this.submitted)
      throw new Error("This occurrence already attempted a submission");
    if (!(await enabled())) throw new Error("Promotion publishing is disabled");
    const preflight = this.currentPreflight;
    if (preflight === undefined)
      throw new Error("Publishing requires a preflight");
    const checked = await readPromotionState(store, target.id);
    assertPromotionOwnership(checked, occurrenceId);
    const decision = promotionEligibility({
      target,
      state: checked,
      preflight,
      observations: this.observations,
      now: now(),
    });
    if (!decision.allowed)
      throw new Error(decision.reason ?? "Promotion is ineligible");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const beforeSubmission = structuredClone(this.observations);
    await updatePromotionState(store, target.id, (state) => {
      assertPromotionOwnership(state, occurrenceId);
      if (
        state.paused ||
        state.attempts.some(
          (item) =>
            item.occurrenceId === occurrenceId || item.status === "uncertain",
        )
      )
        throw new Error("Promotion submission is paused or already attempted");
      return {
        ...state,
        attempts: [
          ...state.attempts,
          {
            occurrenceId,
            attemptedAt: new Date(now()).toISOString(),
            settledAt: null,
            status: "uncertain",
            contentHash,
            beforeSubmission,
            receiptUrl: null,
            evidenceKey: null,
          },
        ],
      };
    });
    this.submitted = true;
    // A failed request deliberately leaves the durable attempt uncertain.
    await submit(selector);
    return {
      status: "submitted",
      instruction:
        "Capture and verify the remote receipt before completing this occurrence",
    };
  }

  async verify(input: {
    status: "verified" | "filtered" | "rejected";
    receiptUrl: string;
    quote: string;
    occurrenceId?: string | undefined;
  }) {
    const { target, capture, store, occurrenceId } = this.dependencies;
    assertPromotionUrl(target, input.receiptUrl);
    const evidence = await capture();
    if (
      evidence.url !== input.receiptUrl ||
      input.quote.length < 5 ||
      !evidence.text.includes(input.quote)
    )
      throw new Error(
        "Receipt requires exact browser readback and a confirmation quote",
      );
    const resolving = input.occurrenceId ?? occurrenceId;
    const current = await readPromotionState(store, target.id);
    const pending = current.attempts.find(
      (candidate) => candidate.occurrenceId === resolving,
    );
    if (pending === undefined)
      throw new Error("No submission matches this receipt");
    assertPromotionReceipt({
      target,
      status: input.status,
      url: evidence.url,
      text: evidence.text,
      quote: input.quote,
      attemptedAt: pending.attemptedAt,
      publishedAt: evidence.publishedAt,
      before: pending.beforeSubmission,
    });
    await updatePromotionState(store, target.id, (state) => {
      assertPromotionOwnership(state, occurrenceId);
      if (
        !state.attempts.some(
          (attempt) =>
            attempt.occurrenceId === resolving &&
            attempt.status === "uncertain",
        )
      )
        throw new Error("No uncertain submission matches this receipt");
      return {
        ...state,
        attempts: state.attempts.map((attempt) =>
          attempt.occurrenceId === resolving
            ? {
                ...attempt,
                status: input.status,
                settledAt: new Date(this.dependencies.now()).toISOString(),
                receiptUrl: evidence.url,
                evidenceKey: evidence.screenshotKey,
              }
            : attempt,
        ),
        blockedReason:
          input.status === "verified"
            ? null
            : `Submission ${input.status}; review required`,
        paused: state.paused || input.status !== "verified",
      };
    });
    return { status: input.status, evidenceKey: evidence.screenshotKey };
  }
}
