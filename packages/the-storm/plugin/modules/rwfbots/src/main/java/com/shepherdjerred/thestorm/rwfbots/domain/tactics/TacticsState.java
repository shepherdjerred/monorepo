package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.Optional;

/**
 * What the think step carries between thinks.
 *
 * @param plan the plan in progress
 * @param lastThinkTick when the bot last thought, or -1
 * @param lifeEpoch how many times the bot has spawned
 * @param bornTick when the bot first thought in the match, or -1
 * @param rewind the bot's model of its Time Machine
 */
public record TacticsState(
    Optional<Plan> plan,
    long lastThinkTick,
    int lifeEpoch,
    long bornTick,
    RewindClock rewind,
    TacticalMemory memory) {

  public static TacticsState fresh(int lifeEpoch) {
    return new TacticsState(
        Optional.empty(), -1, lifeEpoch, -1, RewindClock.UNSTARTED, TacticalMemory.EMPTY);
  }

  /**
   * After the bot stood frozen following its plan: the plan is dropped and its current goal kept
   * out of reach for {@link TacticalMemory#BLOCK_TICKS}, so the next think picks something else to
   * do or recovers instead of taking the same plan again.
   */
  public TacticsState abandon(long tick) {
    var goal =
        plan.flatMap(
            current ->
                switch (current.current()) {
                  case PlanStep.Route route -> Optional.of(route.goal());
                  case PlanStep.Hold hold -> Optional.of(hold.pos());
                  case PlanStep.Cover cover -> Optional.of(cover.pos());
                  case PlanStep.Heal heal -> Optional.of(heal.cover());
                  case PlanStep.Flee flee -> Optional.of(flee.goal());
                  case PlanStep.Pickup pickup -> Optional.of(pickup.cell());
                  default -> Optional.<Vec3>empty();
                });
    return new TacticsState(
        Optional.empty(),
        lastThinkTick,
        lifeEpoch,
        bornTick,
        rewind,
        goal.map(point -> memory.blocked(point, tick)).orElse(memory));
  }

  /**
   * A new life (a death, a teleport, a landed rewind): the plan is dropped; when the match began
   * for the bot and its Time Machine's cooldown carry over, as rwf's do.
   */
  public TacticsState nextLife(int newEpoch) {
    return new TacticsState(
        Optional.empty(), lastThinkTick, newEpoch, bornTick, rewind, TacticalMemory.EMPTY);
  }
}
