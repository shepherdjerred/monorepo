package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/**
 * A supply crate that has landed. The match decides loot rights: the owner at once, their team from
 * {@code teamLootsTick}, and anyone from {@code anyoneLootsTick}.
 *
 * @param pos the block center of the chest
 * @param owner who called it in
 * @param team the owner's team when it landed
 * @param landedTick the match tick it landed
 * @param teamLootsTick the first tick the owner's team may loot it
 * @param anyoneLootsTick the first tick anyone may loot it
 */
public record CrateView(
    Vec3 pos,
    CombatantId owner,
    TeamId team,
    long landedTick,
    long teamLootsTick,
    long anyoneLootsTick) {

  public CrateView {
    if (landedTick < 0) {
      throw new IllegalArgumentException("landed tick must not be negative: " + landedTick);
    }
    if (teamLootsTick < landedTick || anyoneLootsTick < teamLootsTick) {
      throw new IllegalArgumentException(
          "loot ticks must follow landing: "
              + landedTick
              + ", "
              + teamLootsTick
              + ", "
              + anyoneLootsTick);
    }
  }

  /** Whether {@code who}, on {@code whoTeam}, may loot this crate at {@code tick}. */
  public boolean mayLoot(CombatantId who, TeamId whoTeam, long tick) {
    if (who.equals(owner) || tick >= anyoneLootsTick) {
      return true;
    }
    return whoTeam.equals(team) && tick >= teamLootsTick;
  }
}
