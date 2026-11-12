import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PromotionOverviewSchema } from "@shepherdjerred/ops-model/promotion/model.ts";
import { PromotionSpendSummary } from "./spend-summary.tsx";

it("renders old v1 unknown usage conservatively and distinguishes a new reviewed allocation", () => {
  const old = {
    day: "2026-11-12",
    aiUsd: 0.125,
    captchaUsd: 0,
    pendingCaptchaUsd: 0,
    unknownAi: 1,
  };
  const parsed = PromotionOverviewSchema.shape.spend.parse(old);
  expect(parsed).toMatchObject({
    allocatedAiUsd: 0,
    unknownAi: 1,
    unallocatedUnknownAi: 1,
  });
  const legacy = renderToStaticMarkup(
    createElement(PromotionSpendSummary, { spend: parsed }),
  );
  expect(legacy).toContain("1 require accounting before another run");
  expect(legacy).not.toContain("additionally allocated");
  const allocated = PromotionOverviewSchema.shape.spend.parse({
    ...old,
    allocatedAiUsd: 0.04877852,
    unallocatedUnknownAi: 0,
  });
  const modern = renderToStaticMarkup(
    createElement(PromotionSpendSummary, { spend: allocated }),
  );
  expect(modern).toContain("$0.049 additionally allocated to the AI budget");
  expect(modern).toContain("unknown exact cost; 0 require accounting");
  expect(modern).not.toContain("billed");
});
