import { createHash } from "node:crypto";
import { assertPromotionTaskReceipt } from "./task-receipt.ts";
import {
  assertPromotionUrl,
  promotionDispatchAt,
  type PromotionObservation,
  type PromotionRunInput,
  type PromotionTarget,
} from "#shared/promotion.ts";
import {
  assertPromotionOwnership,
  readPromotionState,
  updatePromotionState,
  type PromotionStore,
} from "./store.ts";

import type { PromotionTaskResult } from "./task-contract.ts";
import { promotionObservationText } from "./observation.ts";

/** Checkpoints execution effects and rechecks the caller's saved schedule. */
export class PromotionTaskJournal {
  readonly observations: PromotionObservation[] = [];
  private started = false;
  private uncertainTransport = false;
  private readonly fields = new Map<string, string>();
  constructor(
    private readonly input: {
      target: PromotionTarget;
      occurrenceId: string;
      mode: PromotionRunInput["mode"];
      store: PromotionStore;
      enabled: () => Promise<boolean>;
      now: () => number;
      capture: () => Promise<{
        url: string;
        text: string;
        screenshotKey: string;
        publishedAt?: string | null;
      }>;
    },
  ) {}

  observe(page: { url: string; text: string }): void {
    assertPromotionUrl(this.input.target, page.url);
    this.observations.push({
      ...page,
      id: crypto.randomUUID(),
      capturedAt: new Date(this.input.now()).toISOString(),
    });
  }

  mutationFailed(): void {
    this.uncertainTransport = true;
  }

  async beforeMutation(field?: { key: string; text: string }): Promise<void> {
    const { mode, enabled, store, target, occurrenceId, now } = this.input;
    if (mode !== "run")
      throw new Error("Read-only mode cannot change a promotion");
    if (this.uncertainTransport)
      throw new Error(
        "Previous browser mutation is uncertain; inspect instead of writing again",
      );
    if (!(await enabled())) throw new Error("Promotion publishing is disabled");
    if (field !== undefined) this.fields.set(field.key, field.text);
    const content = [...this.fields.values()].join("\n");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const contentExcerpt = content === "" ? null : content.slice(0, 1000);
    await updatePromotionState(store, target.id, (state) => {
      assertPromotionOwnership(state, occurrenceId);
      if (
        !this.started &&
        state.attempts.some((item) => item.occurrenceId === occurrenceId)
      )
        throw new Error(
          "This occurrence already has an effect checkpoint; reconcile it instead of replaying",
        );
      if (
        state.paused ||
        state.attempts.some(
          (item) =>
            item.status === "uncertain" && item.occurrenceId !== occurrenceId,
        )
      )
        throw new Error("Target paused or a prior effect needs reconciliation");
      if (now() < promotionDispatchAt(target, state, occurrenceId))
        throw new Error("Stored cooldown has not expired");
      if (this.started)
        return {
          ...state,
          attempts: state.attempts.map((item) =>
            item.occurrenceId === occurrenceId
              ? {
                  ...item,
                  contentHash,
                  contentExcerpt,
                }
              : item,
          ),
        };
      return {
        ...state,
        attempts: [
          ...state.attempts,
          {
            occurrenceId,
            attemptedAt: new Date(now()).toISOString(),
            settledAt: null,
            status: "uncertain",
            receiptUrl: null,
            evidenceKey: null,
            contentHash,
            contentExcerpt,
            beforeSubmission: structuredClone(this.observations),
          },
        ],
      };
    });
    this.started = true;
  }

  private async receiptKey(
    receipt: PromotionTaskResult["receipt"],
    resolving: string,
  ): Promise<string | null> {
    if (receipt === null) return null;
    const { target, store } = this.input;
    assertPromotionUrl(target, receipt.url);
    const state = await readPromotionState(store, target.id);
    const pending = state.attempts.find(
      (item) => item.occurrenceId === resolving && item.status === "uncertain",
    );
    if (pending === undefined)
      throw new Error("Receipt does not match an uncertain attempt");
    const page = await this.input.capture();
    assertPromotionTaskReceipt({ target, pending, receipt, page });
    return page.screenshotKey;
  }

  private assertPreviewEvidence(result: PromotionTaskResult): void {
    if (result.status !== "preview") return;
    if (result.evidence.length === 0)
      throw new Error("Prepared preview needs captured live evidence");
    for (const evidence of result.evidence) {
      const captured = this.observations.some(
        (page) =>
          page.url === evidence.url &&
          promotionObservationText(page.text).includes(evidence.quote),
      );
      if (!captured)
        throw new Error(
          `Preview quote is absent from live browser evidence at ${evidence.url}`,
        );
    }
  }

  async finish(result: PromotionTaskResult): Promise<void> {
    const { mode, store, target, occurrenceId, now } = this.input;
    if (
      mode === "preview" &&
      (result.performedAction ||
        result.receipt !== null ||
        result.status === "verified")
    )
      throw new Error("Preview cannot claim a publication or settle a receipt");
    const receipt = result.receipt;
    if (
      result.status === "verified" &&
      (receipt?.status !== "verified" || !result.performedAction)
    )
      throw new Error("Verified result requires a remote receipt");
    this.assertPreviewEvidence(result);
    const resolving = receipt?.occurrenceId ?? occurrenceId;
    const screenshotKey = await this.receiptKey(receipt, resolving);
    if (mode === "reconcile" && receipt === null) return;
    await updatePromotionState(store, target.id, (state) => {
      assertPromotionOwnership(state, occurrenceId);
      const next = result.nextEligibleAt;
      if (
        result.status === "deferred" &&
        (next === null || Date.parse(next) <= now())
      )
        throw new Error("Site cooldown needs a future deadline");
      const deadline =
        next === null
          ? state.nextEligibleAt
          : new Date(
              Date.parse(next) + state.bufferSeconds * 1000,
            ).toISOString();
      return {
        ...state,
        checkedAt: new Date(now()).toISOString(),
        nextEligibleAt: deadline,
        attempts: state.attempts.map((item) => {
          if (item.occurrenceId !== resolving || item.status !== "uncertain")
            return item;
          if (
            receipt === null &&
            (result.performedAction || this.uncertainTransport)
          )
            return item;
          return {
            ...item,
            settledAt: new Date(now()).toISOString(),
            status: receipt?.status ?? "no-action",
            receiptUrl: receipt?.url ?? null,
            evidenceKey: screenshotKey,
          };
        }),
        paused:
          state.paused || (receipt !== null && receipt.status !== "verified"),
      };
    });
  }
}
