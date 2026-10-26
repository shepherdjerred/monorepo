import { createHash } from "node:crypto";
import { assertPromotionTaskReceipt } from "./task-receipt.ts";
import {
  assertPromotionUrl,
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

/** Checkpoints effects, not website steps. The agent owns policy interpretation. */
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
      const latest = Math.max(
        0,
        ...state.attempts
          .filter(
            (item) =>
              item.status !== "no-action" && item.occurrenceId !== occurrenceId,
          )
          .map((item) => Date.parse(item.settledAt ?? item.attemptedAt)),
      );
      const floor =
        latest === 0
          ? 0
          : latest +
            (target.minimumIntervalSeconds + state.bufferSeconds) * 1000;
      if (
        now() <
        Math.max(
          floor,
          state.nextEligibleAt === null ? 0 : Date.parse(state.nextEligibleAt),
        )
      )
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
                  beforeSubmission: structuredClone(this.observations),
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
    const resolving = receipt?.occurrenceId ?? occurrenceId;
    const screenshotKey = await this.receiptKey(receipt, resolving);
    if (mode === "reconcile" && receipt === null) return;
    await updatePromotionState(store, target.id, (state) => {
      assertPromotionOwnership(state, occurrenceId);
      const next = result.nextEligibleAt;
      if (
        ["deferred", "verified"].includes(result.status) &&
        (next === null || Date.parse(next) <= now())
      )
        throw new Error("Deferred result needs a future eligibility deadline");
      const deadline =
        next === null
          ? null
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
