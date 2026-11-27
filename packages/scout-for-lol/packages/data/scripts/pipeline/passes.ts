// The tip passes in order: fill, triage, escalate, repair, re-triage, and the
// final decision on every tip. Combos run beside them (see combos.ts).

import { escalate } from "./escalate.ts";
import { fillPasses } from "./fill.ts";
import { repair } from "./repair.ts";
import {
  type Context,
  type TipState,
  type UnitState,
  drop,
  liveTips,
  snapshot,
} from "./state.ts";
import { asksAboutInteraction, routeOfTip, triage } from "./triage.ts";

const allLive = (units: readonly UnitState[]): TipState[] =>
  units.flatMap((unit) => unit.sets.flatMap((set) => liveTips(set)));

/** Run the tip passes over units that already have their first tips. */
export async function tipPasses(
  ctx: Context,
  units: readonly UnitState[],
): Promise<void> {
  snapshot(ctx, units, "pass 1");
  await fillPasses(ctx, units, (n) => {
    snapshot(ctx, units, `fill ${n.toString()}`);
  });

  // Triage every tip with the Decisions API and route it.
  await triage(ctx, units, "triage");
  const routes = { keep: 0, repair: 0, escalate: 0 };
  const route = new Map<TipState, "keep" | "repair" | "escalate">();
  for (const tip of allLive(units)) {
    const decided = routeOfTip(tip, ctx.thresholds);
    route.set(tip, decided);
    routes[decided] += 1;
  }
  for (const [name, count] of Object.entries(routes)) {
    ctx.ledger.bump("triage", `routed to ${name}`, count);
  }

  // Escalate the uncertain tips: lookup first, then search for what lookup left unsettled.
  await escalate(ctx, units, {
    label: "escalate:lookup",
    search: false,
    select: (tip) => route.get(tip) === "escalate",
  });
  if (ctx.searches.max > 0) {
    await escalate(ctx, units, {
      label: "escalate:search",
      search: true,
      select: (tip) =>
        route.get(tip) === "escalate" &&
        tip.escalation?.verdict === "not-checkable",
    });
  }

  // Repair what is judged wrong: confidently wrong at triage, or wrong on escalation.
  const flagged = new Set(
    allLive(units).filter(
      (tip) =>
        route.get(tip) === "repair" || tip.escalation?.verdict === "wrong",
    ),
  );
  const fixed = await repair(ctx, units, "repair", (tip) => flagged.has(tip));
  snapshot(ctx, units, "repair");

  // Triage the rewrites again; anything still wrong or uncertain is dropped.
  const rewritten = new Set(fixed.rewritten);
  const confirmed = new Set(fixed.confirmed);
  await triage(ctx, units, "retriage", (tip) => rewritten.has(tip));
  const recheck = new Set<TipState>(confirmed);
  for (const tip of fixed.rewritten) {
    const decided = routeOfTip(tip, ctx.thresholds);
    if (decided === "repair") {
      drop(tip, "retriage", "still judged wrong after the rewrite");
    } else if (decided === "escalate") {
      recheck.add(tip);
    }
  }
  await escalate(ctx, units, {
    label: "escalate:recheck",
    search: ctx.searches.max > 0,
    select: (tip) => recheck.has(tip),
  });

  // The final decision on every live tip.
  for (const tip of allLive(units)) {
    const last = tip.escalation?.verdict;
    if (confirmed.has(tip) || (rewritten.has(tip) && recheck.has(tip))) {
      if (last !== "correct") {
        drop(
          tip,
          "final",
          `not confirmed after repair: ${last ?? "no verdict"}`,
        );
      }
      continue;
    }
    if (last === "wrong") {
      drop(tip, "final", "judged wrong and not repaired");
    } else if (last === "not-checkable" && asksAboutInteraction(tip.text)) {
      drop(tip, "final", "an interaction claim that could not be verified");
      ctx.ledger.bump("final", "unverifiable interaction claims dropped");
    } else {
      tip.history.push({
        pass: "final",
        outcome: "kept",
        verified:
          last === "correct"
            ? "escalation"
            : last === undefined
              ? "triage"
              : "unverified",
      });
    }
  }
  snapshot(ctx, units, "final");
}
