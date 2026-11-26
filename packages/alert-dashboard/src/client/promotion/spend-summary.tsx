import type { PromotionOverview } from "@shepherdjerred/ops-model/promotion/model.ts";
import { money } from "./ui.tsx";

/** Today's recorded spend, as figures for the run's figure strip. */
export function spendFigures(spend: PromotionOverview["spend"]) {
  return [
    { label: "AI spend today", value: money(spend.aiUsd) },
    { label: "CAPTCHA spend today", value: money(spend.captchaUsd) },
  ];
}

/** What the spend figures leave out: reviewed allocations and unknown costs. */
export function PromotionSpendSummary({
  spend,
}: {
  spend: PromotionOverview["spend"];
}) {
  return (
    <>
      {spend.allocatedAiUsd > 0 &&
        `${money(spend.allocatedAiUsd)} additionally allocated to the AI budget from reviewed provider totals. `}
      {spend.unknownAi > 0 &&
        `${String(spend.unknownAi)} records still have unknown exact cost; ${String(spend.unallocatedUnknownAi)} require accounting before another run.`}
    </>
  );
}
