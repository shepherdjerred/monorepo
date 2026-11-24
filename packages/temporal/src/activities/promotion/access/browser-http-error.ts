export class PromotionBrowserHttpError extends Error {
  constructor(
    suffix: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Promotion browser ${suffix} HTTP ${String(status)}: ${detail}`);
  }
}
