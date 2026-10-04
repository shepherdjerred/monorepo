package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.List;
import java.util.Optional;

/**
 * What one bot has decided to do, produced by the think step a few times a second and followed by
 * the reflex layer every tick.
 *
 * @param bot who decided
 * @param option the chosen option
 * @param target who to fight, if anyone
 * @param waypoints the path to follow, nearest first; empty to stay put
 * @param stance how to move and fight on the way
 * @param bomb a bomb to click when adjacent, for arming, helping or defusing
 * @param watch a point to keep looking at when there is no target
 * @param ability a kit ability to trigger now
 * @param planLabel a short human-readable label of the plan step, for traces and debug HUDs
 * @param snapshotTick the tick of the snapshot this was decided from
 * @param lifeEpoch how many times this bot has (re)spawned; stale decisions are dropped
 */
public record Decision(
    CombatantId bot,
    Option option,
    Optional<CombatantId> target,
    List<Waypoint> waypoints,
    Stance stance,
    Optional<BombId> bomb,
    Optional<Vec3> watch,
    Optional<String> ability,
    String planLabel,
    long snapshotTick,
    int lifeEpoch) {

  public Decision {
    waypoints = List.copyOf(waypoints);
    if (planLabel.isBlank()) {
      throw new IllegalArgumentException("plan label must not be blank");
    }
    if (snapshotTick < 0 || lifeEpoch < 0) {
      throw new IllegalArgumentException("ticks and epochs must not be negative");
    }
  }

  /** A decision to stand still and do nothing. */
  public static Decision idle(CombatantId bot, long tick, int lifeEpoch) {
    return new Decision(
        bot,
        Option.HOLD_ANGLE,
        Optional.empty(),
        List.of(),
        Stance.CAUTIOUS,
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        "idle",
        tick,
        lifeEpoch);
  }

  public Decision withWaypoints(List<Waypoint> newWaypoints) {
    return new Decision(
        bot,
        option,
        target,
        newWaypoints,
        stance,
        bomb,
        watch,
        ability,
        planLabel,
        snapshotTick,
        lifeEpoch);
  }
}
