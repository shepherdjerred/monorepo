// The pipeline's result in the review set's shape, with each tip's history, the
// tips that were dropped (so the judges can be judged on them too), and the
// combos of a general set and the combo references of a matchup side.

import type { SetState, TipState, UnitState } from "./state.ts";

function tipOut(tip: TipState) {
  const abilities = tip.cites.flatMap((cite) =>
    cite.kind === "ability" ? [cite] : [],
  );
  return {
    id: tip.id,
    text: tip.text,
    abilities: [...new Set(abilities.map((cite) => cite.name))],
    abilityRefs: abilities.map((cite) => ({
      champion: cite.champion,
      slot: cite.slot,
      name: cite.name,
    })),
    judges: {
      sonnet: tip.escalation
        ? { verdict: tip.escalation.verdict, reason: tip.escalation.reason }
        : null,
      decisions: tip.decision
        ? { verdict: tip.decision.verdict, pWrong: tip.decision.pWrong }
        : null,
    },
    history: tip.history,
  };
}

function setOut(unit: UnitState, set: SetState, model: string) {
  const first = set.tips.filter((tip) => tip.status === "live");
  const dropped = set.tips.filter((tip) => tip.status === "dropped");
  const base = {
    id: set.id,
    key: set.id.replace(/^[a-z]+:/u, ""),
    kind: set.opponent === undefined ? "general" : "matchup",
    champion: set.subject.name,
    lane: unit.lane,
    ...(set.opponent === undefined ? {} : { opponent: set.opponent.name }),
    ...(set.side === undefined ? {} : { direction: set.side }),
    model,
    tips: first.map((tip) => tipOut(tip)),
    droppedTips: dropped.map((tip) => ({
      ...tipOut(tip),
      droppedBecause: tip.droppedBecause,
    })),
  };
  return set.opponent === undefined
    ? {
        ...base,
        combos: set.combos
          .filter((entry) => entry.status === "live")
          .map((entry) => ({
            ...entry.combo,
            judges: {
              sonnet: entry.escalation
                ? {
                    verdict: entry.escalation.verdict,
                    reason: entry.escalation.reason,
                  }
                : null,
            },
            history: entry.history,
          })),
        droppedCombos: set.combos
          .filter((entry) => entry.status === "dropped")
          .map((entry) => ({
            ...entry.combo,
            droppedBecause: entry.droppedBecause,
            history: entry.history,
          })),
      }
    : {
        ...base,
        comboRefs: set.comboRefs.map((entry) => ({
          ...entry.ref,
          history: entry.history,
        })),
      };
}

export function serialize(units: readonly UnitState[], model: string) {
  return units.flatMap((unit) =>
    unit.sets.map((set) => setOut(unit, set, model)),
  );
}
