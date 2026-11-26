import type { ReactNode } from "react";
import type {
  GameFact,
  GameFactKind,
} from "@scout-for-lol/data/game-facts/schema.ts";
import { fixtureFacts } from "#src/domain/tooltips/entity-tooltip.facts.ts";
import {
  TooltipScoutRow,
  TooltipScoutRows,
} from "#src/domain/tooltips/entity-tooltip-parts.tsx";
import type { GameFactLoader } from "#src/domain/tooltips/game-fact-store.ts";

/** A loader over the fixture facts, after `delayMs`; honours abort. */
export function fixtureLoader(delayMs = 0): GameFactLoader {
  return (kind: GameFactKind, key: string, { signal }) =>
    new Promise<GameFact>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        const fact = fixtureFacts.find(
          (candidate) => candidate.kind === kind && candidate.key === key,
        );
        if (fact === undefined) {
          reject(new Error(`No fixture for ${kind}/${key}`));
          return;
        }
        resolve(fact);
      }, delayMs);
      signal.addEventListener("abort", () => {
        globalThis.clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
}

/** A loader that never answers, for the skeleton. */
export const stalledLoader: GameFactLoader = (_kind, _key, { signal }) =>
  new Promise<GameFact>((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });

/** A loader whose request fails. */
export const failingLoader: GameFactLoader = () =>
  Promise.reject(new Error("Game fact failed to load (HTTP 404)"));

/** Scout blocks in the shape the mockups use. */
export function scoutFor(kind: GameFactKind, key: string): ReactNode {
  if (kind === "champion") {
    return (
      <TooltipScoutRows context="Patch 16.23, Ranked Solo/Duo, Emerald to Diamond">
        <TooltipScoutRow who="You" you>
          <span>41 games, won 61%</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Friends">
          <span>6 play her</span>
          <span>RiverQuartz is best, at 65%</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Everyone">
          <span>A tier, wins 51.8% of 12,480 games</span>
          <span>Ahead at 15 minutes in 52.4% of 2,460</span>
        </TooltipScoutRow>
      </TooltipScoutRows>
    );
  }
  if (kind === "ability" && key === "Ahri-E") {
    return (
      <TooltipScoutRows>
        <TooltipScoutRow who="Everyone">
          <span>Maxed last by most Ahri players</span>
          <span>Q, then W, then E: wins 52.3% of 8,700 games</span>
        </TooltipScoutRow>
      </TooltipScoutRows>
    );
  }
  if (kind === "item" && key === "3118") {
    return (
      <TooltipScoutRows>
        <TooltipScoutRow who="You" you>
          <span>In 31 of your 41 Ahri games</span>
          <span>Won 65% of those</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Friends">
          <span>In 62 of their 147 Ahri games</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Everyone">
          <span>Ahri&apos;s most played first item</span>
          <span>That build wins 53.1% of 4,210 games</span>
        </TooltipScoutRow>
      </TooltipScoutRows>
    );
  }
  if (kind === "rune") {
    return (
      <TooltipScoutRows>
        <TooltipScoutRow who="You" you>
          <span>In 38 of your 41 Ahri games</span>
          <span>Won 63% of those</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Everyone">
          <span>Ahri&apos;s most played rune page</span>
          <span>Wins 52.6% of 7,840 games</span>
        </TooltipScoutRow>
      </TooltipScoutRows>
    );
  }
  if (kind === "summoner-spell" && key === "14") {
    return (
      <TooltipScoutRows>
        <TooltipScoutRow who="You" you>
          <span>In 36 of your 41 Ahri games</span>
          <span>Won 64% of those</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Everyone">
          <span>With Flash on Ahri, wins 52.1% of 9,900 games</span>
          <span>With Teleport instead, 50.8% of 2,140</span>
        </TooltipScoutRow>
      </TooltipScoutRows>
    );
  }
  return undefined;
}
