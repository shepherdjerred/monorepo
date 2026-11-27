// Fill passes: show the model the set's tips so far and ask for more that are
// distinct and true. Repeat until a pass adds fewer than 2 new tips to a side
// or the side is full, at most `maxFillPasses` passes.
//
// Near-duplicates are caught by the validators' own similarity measure
// (`tipSimilarity`, the Jaccard-style word overlap behind the 0.6 threshold):
// free, deterministic, the same rule that already gates every generated tip. A
// paraphrase with different words slips through it; the model is shown the
// existing tips for that reason, and the judge passes after fill see the whole
// set. A tip that shares eight words in a row with the wiki notes is rejected
// as a copy.

import { sharedWordRun } from "#src/tips/copy-check.ts";
import { GENERAL_TIPS_MAX, MATCHUP_TIPS_MAX } from "#src/tips/schema.ts";
import {
  NEAR_DUPLICATE_SIMILARITY,
  tipSimilarity,
} from "#src/tips/validate-text.ts";
import { checkUnit, newTip, runJobs } from "./draft.ts";
import { basePrompt, writeJob } from "./generate.ts";
import {
  type Context,
  type SetState,
  type UnitState,
  liveTips,
} from "./state.ts";

type NewTip = { text: string; cites: unknown[]; basis: string[] };
type FillDraft = {
  forward?: NewTip[];
  reverse?: NewTip[];
  tips?: NewTip[];
};

const maxFor = (unit: UnitState): number =>
  unit.groundings.length === 2 ? MATCHUP_TIPS_MAX : GENERAL_TIPS_MAX;

function listTips(unit: UnitState): string {
  return unit.sets
    .flatMap((set) => [
      `${set.side === undefined ? "General tips" : set.side === "forward" ? `"forward" (${set.subject.name} against ${set.opponent?.name ?? ""})` : `"reverse" (${set.subject.name} against ${set.opponent?.name ?? ""})`} so far:`,
      ...liveTips(set).map(
        (tip, index) => `${(index + 1).toString()}. ${tip.text}`,
      ),
      "",
    ])
    .join("\n");
}

function fillRest(
  unit: UnitState,
  active: ReadonlySet<string>,
  base: string,
): string {
  const sides = unit.sets
    .filter((set) => active.has(set.id))
    .map((set) => (set.side === undefined ? '"tips"' : `"${set.side}"`));
  return [
    base,
    "",
    "Tips already written (do not repeat, reword or overlap any of them):",
    listTips(unit),
    `Write more tips only for: ${sides.join(", ")}. Each must be a distinct, true thing a player should know that none of the tips above covers: a different ability, phase of the lane or situation. Return an empty list for a side you did not list, and for any side where you have nothing true and distinct to add; never pad, repeat or restate. Keep every rule above (plain sentences, no statistics, cite every ability you name).`,
  ].join("\n");
}

type Stats = {
  added: number;
  duplicate: number;
  copied: number;
  invalid: number;
};

function addCandidates(
  ctx: Context,
  unit: UnitState,
  set: SetState,
  candidates: readonly NewTip[],
  pass: string,
  stats: Stats,
): number {
  const room = maxFor(unit) - liveTips(set).length;
  const others = unit.sets.flatMap((entry) => liveTips(entry));
  let added = 0;
  for (const candidate of candidates) {
    if (added >= room) {
      break;
    }
    const near = others.find(
      (tip) =>
        tipSimilarity(tip.text, candidate.text) >= NEAR_DUPLICATE_SIMILARITY,
    );
    if (near !== undefined) {
      stats.duplicate += 1;
      continue;
    }
    if (sharedWordRun(candidate.text, unit.notes) !== undefined) {
      stats.copied += 1;
      continue;
    }
    const tip = newTip(
      set,
      {
        text: candidate.text,
        cites: candidate.cites as never,
        basis: candidate.basis,
      },
      { pass },
    );
    others.push(tip);
    added += 1;
  }
  void ctx;
  return added;
}

/** Remove new tips the validators reject; if a unit still fails, remove all of its new ones. */
function validateAdded(
  ctx: Context,
  unit: UnitState,
  fresh: Set<string>,
  stats: Stats,
): void {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const checked = checkUnit(ctx, unit);
    if (checked.result !== undefined) {
      return;
    }
    const offenders = new Set(
      checked.issues.flatMap((issue) =>
        issue.tip === undefined ? [] : [issue.tip],
      ),
    );
    let removed = 0;
    for (const set of unit.sets) {
      for (const tip of liveTips(set)) {
        if (fresh.has(tip.id) && offenders.has(tip.text)) {
          tip.status = "dropped";
          tip.droppedBecause = "rejected by the validators when added";
          fresh.delete(tip.id);
          removed += 1;
        }
      }
    }
    stats.invalid += removed;
    if (removed === 0) {
      break;
    }
  }
  if (checkUnit(ctx, unit).result === undefined) {
    for (const set of unit.sets) {
      for (const tip of liveTips(set)) {
        if (fresh.has(tip.id)) {
          tip.status = "dropped";
          tip.droppedBecause = "the unit failed validation with these added";
          stats.invalid += 1;
        }
      }
    }
  }
}

/** Run fill passes; returns tips added per set for each pass that ran. */
export async function fillPasses(
  ctx: Context,
  units: readonly UnitState[],
  afterPass: (pass: number) => void,
): Promise<void> {
  let active = new Map<string, Set<string>>(
    units.map((unit) => [
      unit.id,
      new Set(
        unit.sets
          .filter((set) => liveTips(set).length < maxFor(unit))
          .map((set) => set.id),
      ),
    ]),
  );
  for (let pass = 1; pass <= ctx.maxFillPasses; pass += 1) {
    const label = `fill:${pass.toString()}`;
    const todo = units.filter((unit) => (active.get(unit.id)?.size ?? 0) > 0);
    if (todo.length === 0) {
      break;
    }
    const jobs = todo.map((unit) => {
      const prompt = basePrompt(ctx, unit);
      return writeJob(
        ctx,
        unit,
        `${label}:${unit.id}`,
        fillRest(unit, active.get(unit.id) ?? new Set(), prompt.rest),
        prompt,
      );
    });
    const results = await runJobs(ctx, label, jobs);
    const next = new Map<string, Set<string>>();
    for (const [index, unit] of todo.entries()) {
      const result = results[index];
      const stillActive = new Set<string>();
      next.set(unit.id, stillActive);
      if (result?.outcome.status !== "ok") {
        ctx.ledger.bump(label, "failed jobs");
        continue;
      }
      const draft = result.outcome.object as FillDraft;
      const sides =
        unit.groundings.length === 2
          ? [draft.forward, draft.reverse]
          : [draft.tips];
      const stats: Stats = { added: 0, duplicate: 0, copied: 0, invalid: 0 };
      const fresh = new Set<string>();
      for (const [setIndex, set] of unit.sets.entries()) {
        if (!(active.get(unit.id)?.has(set.id) ?? false)) {
          continue;
        }
        const before = new Set(set.tips.map((tip) => tip.id));
        addCandidates(ctx, unit, set, sides[setIndex] ?? [], label, stats);
        for (const tip of set.tips) {
          if (!before.has(tip.id)) {
            fresh.add(tip.id);
          }
        }
      }
      validateAdded(ctx, unit, fresh, stats);
      for (const set of unit.sets) {
        if (!(active.get(unit.id)?.has(set.id) ?? false)) {
          continue;
        }
        const kept = set.tips.filter(
          (tip) => fresh.has(tip.id) && tip.status === "live",
        ).length;
        ctx.ledger.bump(label, "tips added", kept);
        if (kept >= 2 && liveTips(set).length < maxFor(unit)) {
          stillActive.add(set.id);
        }
      }
      ctx.ledger.bump(label, "dropped as near-duplicates", stats.duplicate);
      ctx.ledger.bump(
        label,
        "dropped as copies of the wiki notes",
        stats.copied,
      );
      ctx.ledger.bump(label, "dropped by the validators", stats.invalid);
    }
    active = next;
    afterPass(pass);
  }
}
