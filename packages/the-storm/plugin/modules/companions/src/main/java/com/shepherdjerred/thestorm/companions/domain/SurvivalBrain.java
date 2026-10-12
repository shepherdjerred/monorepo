package com.shepherdjerred.thestorm.companions.domain;

import java.util.Comparator;
import java.util.List;

/** Reactive survival priorities and utility selection; no network or inference dependencies. */
public final class SurvivalBrain {
  private SurvivalBrain() {}

  public enum Goal {
    DEFEND,
    EAT,
    FOLLOW,
    GATHER_WOOD,
    CRAFT_TOOLS,
    GATHER_STONE,
    FARM,
    BUILD,
    EXPLORE,
    WAIT
  }

  public record Situation(
      boolean threatened,
      int food,
      int meals,
      int logs,
      boolean hasPickaxe,
      int stone,
      boolean hasShelter,
      boolean following,
      boolean stopped) {}

  private record Choice(Goal goal, int utility) {}

  public static Goal choose(Situation state) {
    if (state.threatened()) return Goal.DEFEND;
    if (state.food() <= 16 && state.meals() > 0) return Goal.EAT;
    if (state.stopped()) return Goal.WAIT;
    if (state.following()) return Goal.FOLLOW;
    return List.of(
            new Choice(Goal.FARM, state.meals() < 4 ? 100 : 0),
            new Choice(Goal.GATHER_WOOD, state.logs() < 8 ? 80 : 0),
            new Choice(Goal.CRAFT_TOOLS, !state.hasPickaxe() ? 75 : 0),
            new Choice(Goal.GATHER_STONE, state.stone() < 32 ? 60 : 0),
            new Choice(Goal.BUILD, !state.hasShelter() ? 50 : 0),
            new Choice(Goal.EXPLORE, 1))
        .stream()
        .max(Comparator.comparingInt(Choice::utility))
        .orElseThrow()
        .goal();
  }
}
