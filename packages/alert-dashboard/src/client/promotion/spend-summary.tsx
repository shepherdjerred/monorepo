import type { PromotionOverview } from "@shepherdjerred/ops-model/promotion/model.ts";
import { money } from "./ui.tsx";

export function PromotionSpendSummary({
  spend,
}: {
  spend: PromotionOverview["spend"];
}) {
  return (
    <>
      Recorded spend today: {money(spend.aiUsd)} AI{" + "}
      {money(spend.captchaUsd)} CAPTCHA.
      {spend.allocatedAiUsd > 0 &&
        ` ${money(spend.allocatedAiUsd)} additionally allocated to the AI budget from reviewed provider totals.`}
      {spend.unknownAi > 0 &&
        ` ${String(spend.unknownAi)} records still have unknown exact cost; ${String(spend.unallocatedUnknownAi)} require accounting before another run.`}
    </>
  );
}
