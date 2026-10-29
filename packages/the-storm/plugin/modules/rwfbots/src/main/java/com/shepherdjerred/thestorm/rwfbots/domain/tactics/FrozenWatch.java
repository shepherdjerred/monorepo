package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.Optional;

/**
 * Tells a bot frozen in place from one holding on purpose. A body is still while it stays within
 * {@link #STILL} blocks of one spot and turns less than {@link #STILL_YAW} degrees; it is frozen
 * once it has been still for {@link #FROZEN_TICKS} while its decision sends it somewhere. Holding a
 * post, fighting or healing in place, recovering by standing, and working a fuse within reach (the
 * decision still carries the route to the bomb's approach) are deliberate. In production, bots
 * stood frozen for 3.4 to 3.7% of their time alive on a day's matches.
 */
public final class FrozenWatch {

  /** How long a body must stand still with somewhere to go to count as frozen: 8 s. */
  public static final long FROZEN_TICKS = 160;

  /** How far a still body may drift, in blocks. */
  static final double STILL = 0.15;

  /** How far a still body may turn, in degrees. */
  static final double STILL_YAW = 2;

  private FrozenWatch() {}

  /**
   * Where a body has stood still since when.
   *
   * @param anchor where it stood still
   * @param yaw where it looked
   * @param since the tick it stood still from, or -1 before the first observation
   * @param reported the tick this stillness was last reported as frozen, or -1
   */
  public record State(Vec3 anchor, double yaw, long since, long reported) {
    public static final State START = new State(Vec3.ZERO, 0, -1, -1);
  }

  /**
   * One observation's outcome.
   *
   * @param state what is carried to the next tick
   * @param frozen how long the body has stood frozen, when it first counts as frozen and again
   *     every {@link #FROZEN_TICKS} it stays so
   */
  public record Step(State state, Optional<Long> frozen) {}

  /** Watches {@code self} for one tick of following {@code decision}. */
  public static Step observe(
      State state, CombatantView self, Decision decision, WorldSnapshot snapshot) {
    var tick = snapshot.tick();
    var still =
        state.since() >= 0
            && self.pos().distance(state.anchor()) <= STILL
            && turn(self.yaw(), state.yaw()) <= STILL_YAW;
    if (!still || deliberate(self, decision, snapshot))
      return new Step(new State(self.pos(), self.yaw(), tick, -1), Optional.empty());
    var ticks = tick - state.since();
    if (ticks < FROZEN_TICKS || (state.reported() >= 0 && tick - state.reported() < FROZEN_TICKS))
      return new Step(state, Optional.empty());
    return new Step(
        new State(state.anchor(), state.yaw(), state.since(), tick), Optional.of(ticks));
  }

  /**
   * Whether a body following {@code decision} stands still on purpose: it has nowhere to go, it is
   * eating or drawing, its route failed (recovery handles that), or it works a fuse within reach.
   */
  static boolean deliberate(CombatantView self, Decision decision, WorldSnapshot snapshot) {
    return decision.waypoints().isEmpty()
        || decision.routeFailure().isPresent()
        || self.usingItem()
        || decision
            .bomb()
            .flatMap(snapshot::bomb)
            .filter(bomb -> bomb.pos().distance(self.eye()) <= Reflex.BOMB_REACH)
            .isPresent();
  }

  private static double turn(double yaw, double from) {
    var turn = Math.abs(yaw - from) % 360;
    return Math.min(turn, 360 - turn);
  }
}
