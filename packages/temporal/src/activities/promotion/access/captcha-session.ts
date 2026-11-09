import type {
  PromotionChallenge,
  PromotionCaptchaSolution,
} from "#activities/promotion/solver.ts";

type Entry = {
  pending: Promise<{ taskId: number; costMicrousd: number }>;
  solution?: PromotionCaptchaSolution;
  applied: boolean;
};

/** A paid result belongs to one widget on one actual browser document. */
export class PromotionCaptchaSession {
  private readonly entries = new Map<string, Entry>();

  async solve(input: {
    documentId: string;
    challenge: PromotionChallenge;
    acquire: (
      onSolved: (solution: PromotionCaptchaSolution) => void,
    ) => Entry["pending"];
    apply: (token: string) => Promise<void>;
  }) {
    const c = input.challenge;
    const key = JSON.stringify([
      input.documentId,
      c.websiteURL,
      c.type,
      c.websiteKey,
      c.action,
      c.cData,
      c.chlPageData,
    ]);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      if (!existing.applied) {
        try {
          await existing.pending;
        } catch (error: unknown) {
          if (existing.solution === undefined) throw error;
          await input.apply(existing.solution.token);
        }
        existing.applied = true;
      }
      const result = existing.solution?.result ?? (await existing.pending);
      return {
        ...result,
        reused: true,
        responseStaged: true,
        formSubmitted: false,
        siteAccepted: false,
      };
    }
    const entry: Entry = {
      pending: Promise.resolve().then(() =>
        input.acquire((solution) => {
          entry.solution = solution;
        }),
      ),
      applied: false,
    };
    this.entries.set(key, entry);
    const result = await entry.pending;
    entry.applied = true;
    return {
      ...result,
      reused: false,
      responseStaged: true,
      formSubmitted: false,
      siteAccepted: false,
    };
  }
}
